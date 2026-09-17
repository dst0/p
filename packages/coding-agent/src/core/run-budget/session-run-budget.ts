import { join } from "node:path";
import { type RunBudgetPolicy, validateRunBudgetPolicy } from "../run-budget-policy.ts";
import { assertValidSessionId } from "../session-manager/session-id.ts";
import type { SessionManager } from "../session-manager.ts";
import { RunBudgetError } from "./error.ts";
import { RunBudgetLedger } from "./ledger.ts";
import { runBudgetScope } from "./scope.ts";
import type { RunBudgetSnapshot } from "./types.ts";

interface SessionBudgetScope {
  ledgers: Map<string, RunBudgetLedger>;
  defaultPolicy: RunBudgetPolicy | undefined;
}

export class SessionRunBudget {
  private static readonly scopes = new WeakMap<SessionManager, SessionBudgetScope>();
  private readonly manager: SessionManager;
  private readonly scope: SessionBudgetScope;

  static getPersistedPolicy(manager: SessionManager): RunBudgetPolicy | undefined {
    const scopeId = getBudgetScopeId(manager);
    const location = getBudgetLocation(manager, scopeId);
    if (!location) return undefined;
    const scope = SessionRunBudget.scopes.get(manager) ?? { ledgers: new Map(), defaultPolicy: undefined };
    const existing = scope.ledgers.get(scopeId);
    if (existing) return existing.policy;
    const ledger = RunBudgetLedger.openPersisted({ scopeId, path: location.path, storageRoot: location.root });
    if (!ledger) return undefined;
    scope.ledgers.set(scopeId, ledger);
    SessionRunBudget.scopes.set(manager, scope);
    return ledger.policy;
  }

  constructor(
    manager: SessionManager,
    options: {
      runBudget?: RunBudgetPolicy;
      defaultRunBudget?: RunBudgetPolicy;
      requireDefaultRunBudget?: boolean;
    } = {},
  ) {
    this.manager = manager;
    const currentPolicy = options.runBudget ? validateRunBudgetPolicy(options.runBudget) : undefined;
    const suppliedDefault = options.defaultRunBudget ? validateRunBudgetPolicy(options.defaultRunBudget) : undefined;
    const existingScope = SessionRunBudget.scopes.get(manager);
    this.scope = existingScope ?? {
      ledgers: new Map(),
      defaultPolicy: suppliedDefault ?? (options.requireDefaultRunBudget ? undefined : { mode: "unlimited" }),
    };
    if (existingScope && (options.requireDefaultRunBudget || suppliedDefault)) {
      this.scope.defaultPolicy = suppliedDefault;
    }
    SessionRunBudget.scopes.set(manager, this.scope);
    const initial = this.current(currentPolicy);
    if (currentPolicy) initial.setPolicy(currentPolicy);
  }

  get policy(): RunBudgetPolicy {
    return this.current().policy;
  }

  snapshot(): RunBudgetSnapshot {
    return this.current().snapshot();
  }

  setPolicy(policy: RunBudgetPolicy): void {
    this.current().setPolicy(policy);
    this.scope.defaultPolicy = validateRunBudgetPolicy(policy);
  }

  run<T>(operation: () => T): T {
    return runBudgetScope.run(this.current(), operation);
  }

  private current(initialPolicy?: RunBudgetPolicy): RunBudgetLedger {
    const scopeId = getBudgetScopeId(this.manager);
    const existing = this.scope.ledgers.get(scopeId);
    if (existing) return existing;
    const location = getBudgetLocation(this.manager, scopeId);
    const persisted = location
      ? RunBudgetLedger.openPersisted({ scopeId, path: location.path, storageRoot: location.root })
      : undefined;
    if (persisted) {
      this.scope.ledgers.set(scopeId, persisted);
      return persisted;
    }
    const policy = initialPolicy ?? this.scope.defaultPolicy;
    if (!policy) {
      throw new RunBudgetError(
        "budget_required",
        "Choose a saved default with /budget before creating or forking a task.",
      );
    }
    const ledger = new RunBudgetLedger({
      scopeId,
      policy,
      path: location?.path,
      storageRoot: location?.root,
    });
    this.scope.ledgers.set(scopeId, ledger);
    return ledger;
  }
}

function getBudgetScopeId(manager: SessionManager): string {
  const scopeId = manager.getSessionId();
  try {
    assertValidSessionId(scopeId);
  } catch {
    throw new RunBudgetError("budget_storage_error", "Invalid session budget identity.");
  }
  return scopeId;
}

function getBudgetLocation(manager: SessionManager, scopeId: string): { path: string; root: string } | undefined {
  if (!manager.isPersisted()) return undefined;
  const root = manager.getSessionDir();
  return { path: join(root, ".budgets", `${scopeId}.json`), root };
}
