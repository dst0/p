import type { Model, Usage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { RunBudgetLedger } from "../src/core/run-budget/ledger.ts";

const model: Model<"faux"> = {
  id: "text-cost-accounting",
  name: "text-cost-accounting",
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
  totalTokens: 19,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("run-budget text provider cost accounting", () => {
  it.each([
    {
      name: "OpenAI priority pricing",
      providerUsage: {
        ...usage,
        cost: {
          input: 0.00002,
          output: 0.000012,
          cacheRead: 0.0000004,
          cacheWrite: 0.00001,
          total: 0.00002 + 0.000012 + 0.0000004 + 0.00001,
        },
      },
    },
    {
      name: "Anthropic one-hour cache-write pricing",
      providerUsage: {
        ...usage,
        cacheWrite1h: 4,
        cost: {
          input: 0.00001,
          output: 0.000006,
          cacheRead: 0.0000002,
          cacheWrite: 0.000008,
          total: 0.00001 + 0.000006 + 0.0000002 + 0.000008,
        },
      },
    },
  ])("preserves the larger provider-computed total for $name", ({ providerUsage }) => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "limited", unit: "usd", limit: 1 } });
    ledger.admit({ kind: "text", model }).settle(providerUsage);
    expect(ledger.snapshot()).toMatchObject({
      usd: providerUsage.cost.total,
      uncertainUsd: false,
      status: "ready",
    });
  });

  it("fails closed on a provider total that disagrees with its component breakdown", () => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "limited", unit: "usd", limit: 1 } });
    ledger.admit({ kind: "text", model }).settle({
      ...usage,
      cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 },
    });
    expect(ledger.snapshot()).toMatchObject({ usd: 0, uncertainUsd: true, status: "uncertain" });
    expect(() => ledger.admit({ kind: "text", model })).toThrow(/budget_uncertain/);
  });

  it("fails closed when zero-token text usage is an all-zero error sentinel", () => {
    const ledger = new RunBudgetLedger({ scopeId: "task", policy: { mode: "limited", unit: "usd", limit: 1 } });
    ledger.admit({ kind: "text", model }).settle({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });

    expect(ledger.snapshot()).toMatchObject({ requests: 1, usd: 0, uncertainUsd: true, status: "uncertain" });
    expect(() => ledger.admit({ kind: "text", model })).toThrow(/budget_uncertain/);
    expect(ledger.snapshot().requests).toBe(1);
  });
});
