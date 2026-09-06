import { join } from "node:path";
import { type RunBudgetPolicy, validateRunBudgetPolicy } from "../run-budget-policy.ts";
import type { SessionManager } from "../session-manager.ts";
import { RunBudgetError } from "./error.ts";
import { RunBudgetLedger } from "./ledger.ts";
import { runBudgetScope } from "./scope.ts";
import type { RunBudgetSnapshot } from "./types.ts";

export class SessionRunBudget {
  private static readonly scopes = new WeakMap<
    SessionManager,
    { ledgers: Map<string, RunBudgetLedger>; defaultPolicy: RunBudgetPolicy }
  >();
  private readonly manager: SessionManager;
  private readonly scope: { ledgers: Map<string, RunBudgetLedger>; defaultPolicy: RunBudgetPolicy };

  constructor(
    manager: SessionManager,
    options: { runBudget?: RunBudgetPolicy; defaultRunBudget?: RunBudgetPolicy } = {},
  ) {
    this.manager = manager;
    const defaultPolicy = validateRunBudgetPolicy(
      options.runBudget ?? options.defaultRunBudget ?? { mode: "unlimited" },
    );
    this.scope = SessionRunBudget.scopes.get(manager) ?? { ledgers: new Map(), defaultPolicy };
    SessionRunBudget.scopes.set(manager, this.scope);
    const initial = this.current();
    if (options.runBudget) {
      initial.setPolicy(options.runBudget);
      this.scope.defaultPolicy = defaultPolicy;
    }
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

  private current(): RunBudgetLedger {
    const scopeId = this.manager.getSessionId();
    if (!/^[\da-z-]+$/i.test(scopeId))
      throw new RunBudgetError("budget_storage_error", "Invalid session budget identity.");
    const existing = this.scope.ledgers.get(scopeId);
    if (existing) return existing;
    const ledger = new RunBudgetLedger({
      scopeId,
      policy: this.scope.defaultPolicy,
      path: this.manager.isPersisted() ? join(this.manager.getSessionDir(), ".budgets", `${scopeId}.json`) : undefined,
    });
    this.scope.ledgers.set(scopeId, ledger);
    return ledger;
  }
}
