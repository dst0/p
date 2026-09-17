import { describe, expect, it } from "vitest";
import {
  RunBudgetError,
  type RunBudgetPolicy,
  type RunBudgetSnapshot,
  SessionManager,
  SessionRunBudget,
} from "../src/index.ts";

describe("public task-budget API", () => {
  it("exports the policy, snapshot, controller, and typed runtime error through the package facade", () => {
    const policy: RunBudgetPolicy = { mode: "limited", unit: "requests", limit: 3 };
    const budget: SessionRunBudget = new SessionRunBudget(SessionManager.inMemory(), { runBudget: policy });
    const snapshot: RunBudgetSnapshot = budget.snapshot();
    const error = new RunBudgetError("budget_exhausted", "Task limit reached");

    expect(snapshot.policy).toEqual(policy);
    expect(budget).toBeInstanceOf(SessionRunBudget);
    expect(error).toMatchObject({ name: "RunBudgetError", code: "budget_exhausted" });
  });
});
