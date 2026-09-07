import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, Usage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { RunBudgetLedger } from "../src/core/run-budget/ledger.ts";

const model: Model<"faux"> = {
  id: "ledger-test",
  name: "ledger-test",
  api: "faux",
  provider: "faux",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
  contextWindow: 1000,
  maxTokens: 100,
};
const usage: Usage = {
  input: 10,
  output: 3,
  cacheRead: 2,
  cacheWrite: 4,
  cacheWrite1h: 2,
  totalTokens: 19,
  cost: { input: 0.00001, output: 0.000006, cacheRead: 0.0000002, cacheWrite: 0.000005, total: 0.0000212 },
};
const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("task spend ledger", () => {
  it("reserves the last request atomically and retains valid final-response usage", () => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "limited", unit: "requests", limit: 1 } });
    const receipt = ledger.admit({ kind: "text", model });
    expect(() => ledger.admit({ kind: "text", model })).toThrow(/budget_exhausted/);
    receipt.settle(usage);
    receipt.settle(usage);
    expect(ledger.snapshot()).toMatchObject({ requests: 1, tokens: 19, usd: usage.cost.total, pending: 0 });
  });

  it("never installs a hidden request cap in Unlimited, and changing policy retains spend", () => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "unlimited" } });
    for (let index = 0; index < 101; index++) ledger.admit({ kind: "text", model }).settle(usage);
    expect(ledger.snapshot()).toMatchObject({ requests: 101, status: "ready" });
    ledger.setPolicy({ mode: "limited", unit: "requests", limit: 102 });
    ledger.admit({ kind: "text", model }).settle(undefined);
    expect(() => ledger.admit({ kind: "text", model })).toThrow(/budget_exhausted/);
  });

  it("uses cumulative cached tokens once and blocks after the response crosses the token threshold", () => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "limited", unit: "tokens", limit: 18 } });
    ledger.admit({ kind: "text", model }).settle(usage);
    expect(ledger.snapshot().tokens).toBe(19);
    expect(() => ledger.admit({ kind: "text", model })).toThrow(/budget_exhausted/);
  });

  it("does not treat unknown prices or usage as free", () => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "limited", unit: "usd", limit: 1 } });
    expect(() =>
      ledger.admit({ kind: "text", model: { ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }),
    ).toThrow(/budget_pricing_required/);
    expect(ledger.snapshot().requests).toBe(0);
    ledger.admit({ kind: "text", model }).settle(undefined);
    expect(ledger.snapshot().status).toBe("uncertain");
    expect(() => ledger.admit({ kind: "text", model })).toThrow(/budget_uncertain/);
    ledger.setPolicy({ mode: "unlimited" });
    expect(ledger.snapshot().status).toBe("ready");
    ledger.admit({ kind: "text", model }).settle(usage);
  });

  it("persists admission before a first assistant message and coordinates two ledger instances", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-budget-ledger-"));
    paths.push(directory);
    const path = join(directory, "task.json");
    const options = { scopeId: "task", path, policy: { mode: "limited", unit: "requests", limit: 1 } } as const;
    const first = new RunBudgetLedger(options);
    const second = new RunBudgetLedger(options);
    const receipt = first.admit({ kind: "text", model });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ requests: 1 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => second.admit({ kind: "text", model })).toThrow(/budget_exhausted/);
    receipt.settle(usage);
    expect(second.snapshot()).toMatchObject({ pending: 0, tokens: 19 });
    expect(readFileSync(path, "utf8")).not.toContain("ledger-test");
  });

  it("preserves unresolved crash spend, and does not replace a resumed policy with a new default", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-budget-recovery-"));
    paths.push(directory);
    const path = join(directory, "task.json");
    new RunBudgetLedger({ scopeId: "task", path, policy: { mode: "limited", unit: "tokens", limit: 100 } }).admit({
      kind: "text",
      model,
    });
    const resumed = new RunBudgetLedger({ scopeId: "task", path, policy: { mode: "unlimited" } });
    expect(resumed.policy).toEqual({ mode: "limited", unit: "tokens", limit: 100 });
    expect(() => resumed.admit({ kind: "text", model })).toThrow(/budget_uncertain/);
    expect(resumed.snapshot()).toMatchObject({ requests: 1, pending: 1 });
  });

  it("fails closed on a truncated state file instead of silently starting a fresh allowance", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-budget-corrupt-"));
    paths.push(directory);
    const path = join(directory, "task.json");
    writeFileSync(path, '{"version":1', { mode: 0o600 });
    expect(() => new RunBudgetLedger({ scopeId: "task", path, policy: { mode: "unlimited" } })).toThrow(
      /budget_storage_error/,
    );
  });
});
