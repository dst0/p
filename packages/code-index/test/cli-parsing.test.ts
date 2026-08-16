import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.ts";

describe("CLI argument parser options and default values", () => {
  it("handles batch-size and limit with default fallbacks when args are omitted", () => {
    const parsedBatch = parseArgs(["node", "cli.ts", "--batch-size"]);
    expect(parsedBatch.batchSize).toBe(64);
    const parsedLimit = parseArgs(["node", "cli.ts", "--limit"]);
    expect(parsedLimit.limit).toBe(10);
  });
});
