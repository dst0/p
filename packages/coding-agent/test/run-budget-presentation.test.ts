import { getModel } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { RunBudgetLedger } from "../src/core/run-budget/ledger.ts";
import { formatRunBudget } from "../src/core/run-budget/presentation.ts";

describe("honest budget spend presentation", () => {
  it("distinguishes unstarted zero spend from missing usage, including in Unlimited", () => {
    const ledger = new RunBudgetLedger({ scopeId: "display", policy: { mode: "unlimited" } });
    expect(formatRunBudget(ledger.snapshot())).not.toContain("incomplete");
    const receipt = ledger.admit({ kind: "text", model: getModel("openai", "gpt-4o-mini") });
    expect(formatRunBudget(ledger.snapshot())).toContain("0 tokens recorded (incomplete)");
    expect(formatRunBudget(ledger.snapshot())).toContain("$0.0000 recorded (incomplete)");
    receipt.settle(undefined);
    expect(ledger.snapshot()).toMatchObject({
      policy: { mode: "unlimited" },
      status: "ready",
      pending: 0,
      uncertainTokens: true,
      uncertainUsd: true,
    });
    expect(formatRunBudget(ledger.snapshot())).toContain("recorded (incomplete)");
  });
});
