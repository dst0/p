import { existsSync } from "node:fs";
import { join } from "node:path";
import { listFixtureFiles, readFixtureFiles, readWorkspaceText } from "./fixture-files.ts";
import { runFixtureCommand } from "./fixture-verification.ts";
import { type BenchmarkTask, createTaskResult } from "./task-definition.ts";

const taskId = "monolith-split";
const maxScore = 6;

export const monolithSplitTask: BenchmarkTask = {
  id: taskId,
  timeoutSeconds: 1200,
  maxScore,
  description: "Split a large existing TypeScript module into focused files without changing its public behavior",
  files: readFixtureFiles(taskId),
  prompt: `Treat this as an existing TypeScript repository. Read README.md, package.json, tsconfig.json, the large src/monolith.ts, and the contract tests. Split the monolith into focused modules named src/parser.ts, src/query.ts, and src/report.ts (additional shared modules are fine). Keep src/monolith.ts as a small compatibility facade that preserves every public export and the existing import path. Do not modify the contract test or project configuration, do not change behavior, and add tests for the extracted modules. Use the existing toolchain; do not install dependencies. Run npm test and npm run typecheck until both pass. When all requirements and tests pass, create finish_notes.md summarizing your verification before concluding.`,
  verify(workspace, baseline) {
    const preservedFiles = ["README.md", "package.json", "tsconfig.json", "test/monolith.contract.test.ts"];
    const contractPreserved = preservedFiles.every(
      (file) => readWorkspaceText(join(workspace, file)) === baseline[file],
    );
    const monolith = readWorkspaceText(join(workspace, "src/monolith.ts")) ?? "";
    const monolithLines = monolith.split(/\r?\n/).length;
    const originalLines = (baseline["src/monolith.ts"] ?? "").split(/\r?\n/).length;
    const facadeReduced = monolithLines <= 100 && monolithLines < originalLines / 2;
    const focusedModules = ["src/parser.ts", "src/query.ts", "src/report.ts"].every((file) =>
      existsSync(join(workspace, file)),
    );
    const testRoot = join(workspace, "test");
    const testFiles = existsSync(testRoot)
      ? listFixtureFiles(testRoot).filter((file) => file !== "monolith.contract.test.ts")
      : [];
    const addedTests = testFiles.some((file) =>
      /(test|it|describe)\(/.test(readWorkspaceText(join(testRoot, file)) ?? ""),
    );
    const testsPass = runFixtureCommand(workspace, ["test"]).status === 0;
    const typecheckPasses = runFixtureCommand(workspace, ["run", "typecheck"]).status === 0;
    return createTaskResult(
      contractPreserved && facadeReduced && focusedModules && addedTests && testsPass && typecheckPasses,
      [
        { name: "README, config, and contract preserved", passed: contractPreserved },
        { name: "monolith reduced to a compatibility facade", passed: facadeReduced },
        { name: "parser, query, and report modules exist", passed: focusedModules },
        { name: "agent added extracted-module tests", passed: addedTests },
        { name: "npm test passes", passed: testsPass },
        { name: "npm run typecheck passes", passed: typecheckPasses },
      ],
      maxScore,
    );
  },
};
