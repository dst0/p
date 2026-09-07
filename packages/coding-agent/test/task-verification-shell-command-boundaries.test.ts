import { describe, expect, it } from "vitest";
import {
  focusedShellInvocation,
  focusedShellInvocationWords,
} from "../src/core/task-verification/taskverificationcontroller-methods/focused-shell-command.ts";
import { focusedTestInvocation } from "../src/core/task-verification/taskverificationcontroller-methods/test-command-invocation.ts";

describe("task verification focused shell command boundaries", () => {
  it("returns focused words while preserving escaped spaces and quoted escapes", () => {
    expect(focusedShellInvocationWords("vitest run test/parser\\ case.test.ts")).toEqual([
      "vitest",
      "run",
      "test/parser case.test.ts",
    ]);
    expect(focusedShellInvocation('vitest run "test/parser\\"quote.test.ts"')).toEqual({
      words: ["vitest", "run", 'test/parser"quote.test.ts'],
    });
  });

  it("rejects top-level newlines and empty commands instead of treating them as one focused run", () => {
    expect(focusedShellInvocation("vitest run test/parser.test.ts\nnode --test test/other.test.ts")).toBeUndefined();
    expect(focusedShellInvocation("\nvitest run test/parser.test.ts")).toBeUndefined();
  });

  it("records attached env working directories in wrapper order", () => {
    expect(focusedTestInvocation("env -C=/outer env --chdir=/inner vitest run test/parser.test.ts")).toMatchObject({
      args: ["test/parser.test.ts"],
      workingDirectories: ["/outer", "/inner"],
    });
  });
});
