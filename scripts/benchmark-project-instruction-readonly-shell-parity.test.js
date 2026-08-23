import assert from "node:assert/strict";
import { test } from "node:test";
import { isConfidentlyReadOnlyShellTool } from "../packages/coding-agent/src/core/task-verification/tool-classification.ts";
import { isBenchmarkProjectInstructionReadOnlyShellTool } from "./benchmark-project-instruction-routing.js";

test("benchmark read-only shell recognition stays in parity with production", () => {
  const cases = [
    [true, "bash", { command: "cat requirements.md" }],
    [true, "bash", { command: "rg calculator src | head -n 20" }],
    [true, "bash", { command: "git status --short" }],
    [true, "bash", { command: "file requirements.md" }],
    [false, "bash", { command: "find . -type f -exec rm {} +" }],
    [false, "bash", { command: "rg --pre 'rm -f marker' calculator" }],
    [false, "bash", { command: "file -C -m custom.magic" }],
    [false, "bash", { command: "git diff --output=marker HEAD^" }],
    [false, "bash", { command: "git show --output marker HEAD" }],
    [false, "bash", { command: "./cat requirements.md" }],
    [false, "bash", { command: "/tmp/git status" }],
    [false, "bash", { command: "npm test" }],
    [false, "bash", { command: "cat requirements.md > copy.md" }],
    [false, "bash", { command: "cat $(touch marker)" }],
  ];
  for (const [expected, toolName, args] of cases) {
    assert.equal(isConfidentlyReadOnlyShellTool(toolName, args), expected, `production: ${args.command}`);
    assert.equal(
      isBenchmarkProjectInstructionReadOnlyShellTool(toolName, args),
      expected,
      `benchmark: ${args.command}`,
    );
    assert.equal(
      isBenchmarkProjectInstructionReadOnlyShellTool(toolName, args),
      isConfidentlyReadOnlyShellTool(toolName, args),
      `parity: ${args.command}`,
    );
  }
});
