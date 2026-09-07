import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { parseRunBudgetArgument, validateRunBudgetPolicy } from "../src/core/run-budget-policy.ts";

describe("explicit run budget policy", () => {
  it.each([
    ["unlimited", { mode: "unlimited" }],
    ["requests:12", { mode: "limited", unit: "requests", limit: 12 }],
    ["tokens:25000", { mode: "limited", unit: "tokens", limit: 25000 }],
    ["usd:0.25", { mode: "limited", unit: "usd", limit: 0.25 }],
  ])("parses and validates %s without installing unrelated ceilings", (argument, policy) => {
    expect(parseRunBudgetArgument(argument as string)).toEqual(policy);
    const validated = validateRunBudgetPolicy(policy);
    expect(validated).toEqual(policy);
    expect(validated).not.toBe(policy);
    expect(parseArgs(["--budget", argument as string]).runBudget).toEqual(policy);
    expect(parseArgs([`--budget=${argument}`]).runBudget).toEqual(policy);
  });

  it.each([
    "",
    "limited",
    "request:2",
    "requests:0",
    "requests:-1",
    "tokens:1.5",
    "requests:1e2",
    "usd:NaN",
    "usd:Infinity",
    "usd:0",
    "usd:2oops",
    "tokens:9007199254740992",
    "unlimited:2",
  ])("rejects invalid CLI policy %j before it becomes an extension flag", (argument) => {
    expect(() => parseRunBudgetArgument(argument)).toThrow();
    const parsed = parseArgs(["--budget", argument]);
    expect(parsed.runBudget).toBeUndefined();
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ type: "error" })]);
    expect(parsed.unknownFlags.has("budget")).toBe(false);
  });

  it.each([
    undefined,
    null,
    [],
    "unlimited",
    {},
    { mode: "unlimited", limit: 5 },
    { mode: "limited", unit: "tokens", limit: Number.POSITIVE_INFINITY },
    { mode: "limited", unit: "requests", limit: 1.2 },
    { mode: "limited", unit: "usd", limit: "3" },
    { mode: "limited", unit: "requests", limit: 2, hiddenCap: 1 },
  ])("rejects malformed persisted values %j", (value) => {
    expect(() => validateRunBudgetPolicy(value)).toThrow();
  });

  it("does not consume another option as the missing budget value", () => {
    const parsed = parseArgs(["--budget", "--offline"]);
    expect(parsed.offline).toBe(true);
    expect(parsed.runBudget).toBeUndefined();
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ type: "error" })]);
  });
});
