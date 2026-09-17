import { randomUUID } from "node:crypto";
import {
  type ModelCallAccounting,
  type ModelCallAdmission,
  type ModelCallReceipt,
  type ModelCallSettlementDetails,
  type Usage,
  validateModelCallAccounting,
} from "@dst0/p-ai";
import { type RunBudgetPolicy, validateRunBudgetPolicy } from "../run-budget-policy.ts";
import { RunBudgetError } from "./error.ts";
import { RunBudgetStorage } from "./state-storage.ts";
import type { RunBudgetSnapshot, RunBudgetState } from "./types.ts";

export class RunBudgetLedger {
  private readonly storage: RunBudgetStorage;
  private storageFailed = false;

  static openPersisted(options: { scopeId: string; path: string; storageRoot?: string }): RunBudgetLedger | undefined {
    const ledger = new RunBudgetLedger({ ...options, policy: { mode: "unlimited" } });
    return ledger.storage.hasPersistedState ? ledger : undefined;
  }

  constructor(options: {
    scopeId: string;
    policy: RunBudgetPolicy;
    path?: string;
    storageRoot?: string;
    override?: boolean;
  }) {
    this.storage = new RunBudgetStorage(
      {
        version: 1,
        scopeId: options.scopeId,
        policy: validateRunBudgetPolicy(options.policy),
        requests: 0,
        tokens: 0,
        usd: 0,
        pending: [],
        uncertainTokens: false,
        uncertainUsd: false,
      },
      options.path,
      options.storageRoot,
    );
    if (options.override) this.setPolicy(options.policy);
  }

  get policy(): RunBudgetPolicy {
    return this.storage.read().policy;
  }

  setPolicy(policy: RunBudgetPolicy): void {
    const validated = validateRunBudgetPolicy(policy);
    this.storage.update((state) => {
      state.policy = validated;
    });
    this.storageFailed = false;
  }

  snapshot(): RunBudgetSnapshot {
    const state = this.storage.read();
    const problem = this.problem(state);
    return {
      scopeId: state.scopeId,
      policy: state.policy,
      requests: state.requests,
      tokens: state.tokens,
      usd: state.usd,
      pending: state.pending.length,
      uncertainTokens: state.uncertainTokens || state.pending.length > 0,
      uncertainUsd: state.uncertainUsd || state.pending.length > 0,
      status: problem?.code === "budget_exhausted" ? "exhausted" : problem ? "uncertain" : "ready",
      ...(problem ? { reason: problem.message } : {}),
    };
  }

  admit(call: ModelCallAdmission): ModelCallReceipt {
    const id = randomUUID();
    const kind = call.kind;
    const rates = { ...call.model.cost };
    const accounting = resolveAccounting(call);
    this.storage.update((state) => {
      const problem = this.problem(state);
      if (problem) throw problem;
      if (state.policy.mode === "limited") {
        if (state.policy.unit === "tokens" && accounting.tokens === "unsupported") {
          throw new RunBudgetError(
            "budget_pricing_required",
            "This image adapter cannot report token usage. Choose requests or Unlimited before generating images.",
          );
        }
        if (state.policy.unit === "usd") this.requireUsdAccounting(call, accounting, rates);
      }
      if (!Number.isSafeInteger(state.requests + 1))
        throw new RunBudgetError("budget_uncertain", "Request accounting capacity exceeded.");
      state.requests++;
      state.pending.push(id);
    });
    let settled = false;
    return {
      settle: (usage, details) => {
        if (settled) return;
        settled = true;
        try {
          this.settle(id, usage, rates, accounting, kind, details);
        } catch (error) {
          this.storageFailed = true;
          throw error;
        }
      },
    };
  }

  private requireUsdAccounting(
    call: ModelCallAdmission,
    accounting: ModelCallAccounting,
    rates: ModelCallAdmission["model"]["cost"],
  ): void {
    if (accounting.usd === "unsupported") {
      throw new RunBudgetError(
        "budget_pricing_required",
        "This image adapter cannot report or safely estimate USD cost. Choose requests or Unlimited before generating images.",
      );
    }
    if (!hasValidRates(rates)) {
      throw new RunBudgetError(
        "budget_pricing_required",
        "This model needs known USD rates. Supply model pricing or choose requests, tokens, or Unlimited.",
      );
    }
    if (accounting.usd === "reported") return;
    const usableRates =
      call.kind === "text" ? rates.input > 0 && rates.output > 0 : rates.input > 0 || rates.output > 0;
    if (!usableRates) {
      throw new RunBudgetError(
        "budget_pricing_required",
        "This model needs known USD rates. Supply model pricing or choose requests, tokens, or Unlimited.",
      );
    }
  }

  private problem(state: RunBudgetState): RunBudgetError | undefined {
    if (this.storageFailed)
      return new RunBudgetError("budget_storage_error", "A previous spend receipt could not be saved.");
    const policy = state.policy;
    if (policy.mode === "unlimited") return undefined;
    const amount = policy.unit === "requests" ? state.requests : policy.unit === "tokens" ? state.tokens : state.usd;
    if (amount >= policy.limit)
      return new RunBudgetError(
        "budget_exhausted",
        `${policy.unit} allowance consumed. Use /budget or --budget to change it; partial work is retained.`,
      );
    const uncertain = policy.unit === "tokens" ? state.uncertainTokens : state.uncertainUsd;
    if (policy.unit !== "requests" && (uncertain || state.pending.length > 0)) {
      return new RunBudgetError(
        "budget_uncertain",
        "A model call has unresolved usage. Wait for it to finish, or explicitly choose a request budget or Unlimited.",
      );
    }
    return undefined;
  }

  private settle(
    id: string,
    usage: Usage | undefined,
    rates: ModelCallAdmission["model"]["cost"],
    accounting: ModelCallAccounting,
    kind: ModelCallAdmission["kind"],
    details?: ModelCallSettlementDetails,
  ): void {
    this.storage.update((state) => {
      if (!state.pending.includes(id)) return;
      state.pending = state.pending.filter((pending) => pending !== id);
      const validCounts = usage !== undefined && hasConsistentTokenCounts(usage);
      const tokens = validCounts ? usage.totalTokens : undefined;
      if (tokens === undefined || tokens <= 0 || !Number.isSafeInteger(state.tokens + tokens)) {
        state.uncertainTokens = true;
      } else {
        state.tokens += tokens;
      }

      const cost = resolveUsdCost(usage, rates, accounting, kind, details);
      if (cost === undefined || !Number.isFinite(state.usd + cost)) {
        state.uncertainUsd = true;
        return;
      }
      state.usd += cost;
    });
  }
}

function resolveAccounting(call: ModelCallAdmission): ModelCallAccounting {
  if (call.kind === "text") return { tokens: "reported", usd: "model-rates" };
  return validateModelCallAccounting(call.accounting ?? { tokens: "unsupported", usd: "unsupported" });
}

function resolveUsdCost(
  usage: Usage | undefined,
  rates: ModelCallAdmission["model"]["cost"],
  accounting: ModelCallAccounting,
  kind: ModelCallAdmission["kind"],
  details?: ModelCallSettlementDetails,
): number | undefined {
  if (accounting.usd === "unsupported") return undefined;
  if (usage !== undefined && !hasConsistentTokenCounts(usage)) return undefined;
  const validRates = hasValidRates(rates);
  const priced =
    usage && validRates
      ? (usage.input * rates.input +
          usage.output * rates.output +
          usage.cacheRead * rates.cacheRead +
          usage.cacheWrite * rates.cacheWrite) /
        1_000_000
      : undefined;
  if (accounting.usd === "model-rates") {
    if (!isValidCost(priced)) return undefined;
    if (kind === "image") return priced;
    if (
      usage?.totalTokens === 0 &&
      usage.cost.input === 0 &&
      usage.cost.output === 0 &&
      usage.cost.cacheRead === 0 &&
      usage.cost.cacheWrite === 0 &&
      usage.cost.total === 0
    ) {
      return undefined;
    }
    const providerComputed = resolveProviderComputedCost(usage);
    return providerComputed === undefined ? undefined : Math.max(priced, providerComputed);
  }
  const reported = details?.reportedUsd;
  if (!isValidCost(reported)) return undefined;
  return isValidCost(priced) ? Math.max(reported, priced) : reported;
}

function hasValidRates(rates: ModelCallAdmission["model"]["cost"]): boolean {
  return [rates.input, rates.output, rates.cacheRead, rates.cacheWrite].every(isValidCost);
}

function hasConsistentTokenCounts(usage: Usage): boolean {
  const counts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0)) return false;
  const componentTotal = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return Number.isSafeInteger(componentTotal) && usage.totalTokens === componentTotal;
}

function resolveProviderComputedCost(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined;
  const components = [usage.cost.input, usage.cost.output, usage.cost.cacheRead, usage.cost.cacheWrite];
  if (!components.every(isValidCost) || !isValidCost(usage.cost.total)) return undefined;
  const total = components.reduce((sum, component) => sum + component, 0);
  return Number.isFinite(total) && usage.cost.total === total ? total : undefined;
}

function isValidCost(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
