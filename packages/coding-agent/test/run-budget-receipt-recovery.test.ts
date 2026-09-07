import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { RunBudgetLedger } from "../src/core/run-budget/ledger.ts";

describe("receipt persistence recovery", () => {
  it("blocks further calls after a failed receipt even when the durable admission file becomes readable again", () => {
    const root = mkdtempSync(join(tmpdir(), "p-budget-receipt-"));
    const path = join(root, "ledger.json");
    const saved = join(root, "saved-admission.json");
    try {
      const ledger = new RunBudgetLedger({ scopeId: "receipt", path, policy: { mode: "unlimited" } });
      const call = { kind: "text", model: getModel("openai", "gpt-4o-mini") } as const;
      const receipt = ledger.admit(call);
      renameSync(path, saved);
      mkdirSync(path);
      expect(() => receipt.settle(undefined)).toThrow(/budget_storage_error/);
      rmSync(path, { recursive: true });
      renameSync(saved, path);
      expect(ledger.snapshot()).toMatchObject({ requests: 1, pending: 1, status: "uncertain" });
      expect(() => ledger.admit(call)).toThrow(/previous spend receipt/);
      ledger.setPolicy({ mode: "unlimited" });
      expect(ledger.snapshot()).toMatchObject({ requests: 1, pending: 1, status: "ready", uncertainTokens: true });
      ledger.admit(call).settle(undefined);
      expect(ledger.snapshot()).toMatchObject({ requests: 2, pending: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
