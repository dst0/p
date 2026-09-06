import { randomUUID } from "node:crypto";
import type { ModelCallAdmission, ModelCallReceipt, Usage } from "@dst0/p-ai";
import { type RunBudgetPolicy, validateRunBudgetPolicy } from "../run-budget-policy.ts";
import { RunBudgetError } from "./error.ts";
import { RunBudgetStorage } from "./state-storage.ts";
import type { RunBudgetSnapshot, RunBudgetState } from "./types.ts";

export class RunBudgetLedger {
  private readonly storage: RunBudgetStorage;
  private storageFailed = false;

  constructor(options: { scopeId: string; policy: RunBudgetPolicy; path?: string; override?: boolean }) {
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
    const rates = { ...call.model.cost };
    this.storage.update((state) => {
      const problem = this.problem(state);
      if (problem) throw problem;
      if (state.policy.mode === "limited" && state.policy.unit === "usd") {
        if (
          !Object.values(rates).every((rate) => Number.isFinite(rate) && rate >= 0) ||
          rates.input <= 0 ||
          rates.output <= 0
        ) {
          throw new RunBudgetError(
            "budget_pricing_required",
            "This model needs known input/output USD rates. Supply model pricing or choose requests, tokens, or Unlimited.",
          );
        }
      }
      if (!Number.isSafeInteger(state.requests + 1))
        throw new RunBudgetError("budget_uncertain", "Request accounting capacity exceeded.");
      state.requests++;
      state.pending.push(id);
    });
    let settled = false;
    return {
      settle: (usage) => {
        if (settled) return;
        settled = true;
        try {
          this.settle(id, usage, rates);
        } catch (error) {
          this.storageFailed = true;
          throw error;
        }
      },
    };
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

  private settle(id: string, usage: Usage | undefined, rates: ModelCallAdmission["model"]["cost"]): void {
    this.storage.update((state) => {
      if (!state.pending.includes(id)) return;
      state.pending = state.pending.filter((pending) => pending !== id);
      const counts = usage ? [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens] : [];
      if (!usage || counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
        state.uncertainTokens = true;
        state.uncertainUsd = true;
        return;
      }
      const tokens = Math.max(usage.totalTokens, usage.input + usage.output + usage.cacheRead + usage.cacheWrite);
      if (tokens <= 0 || !Number.isSafeInteger(state.tokens + tokens)) {
        state.uncertainTokens = true;
        state.uncertainUsd = true;
        return;
      }
      state.tokens += tokens;
      const reported = usage.cost?.total;
      const priced =
        (usage.input * rates.input +
          usage.output * rates.output +
          usage.cacheRead * rates.cacheRead +
          usage.cacheWrite * rates.cacheWrite) /
        1_000_000;
      const cost = typeof reported === "number" ? Math.max(reported, priced) : priced;
      if (
        !Number.isFinite(cost) ||
        cost < 0 ||
        !Number.isFinite(state.usd + cost) ||
        (cost === 0 && rates.input <= 0 && rates.output <= 0)
      ) {
        state.uncertainUsd = true;
        return;
      }
      state.usd += cost;
    });
  }
}
