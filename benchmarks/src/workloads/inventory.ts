import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashSnapshotDirectory } from "../harness/runtime-snapshot.ts";
import { listFixtureFiles, readFixtureFiles, readFixtureText, readWorkspaceText } from "./fixture-files.ts";
import { runFixtureCommand } from "./fixture-verification.ts";
import { runHiddenVerification } from "./hidden-verification.ts";
import { readHiddenRubric } from "./rubric.ts";
import { type BenchmarkTask, canonicalTaskTimeoutSeconds, createTaskResult } from "./task-definition.ts";

const taskId = "event-sourced-inventory";
const maxScore = 100;
const agentHiddenFiles = new Set(["hidden.test.ts", "rubric.json"]);
export const inventoryHiddenRubric = readHiddenRubric(taskId);

export const inventoryTask: BenchmarkTask = {
  id: taskId,
  timeoutSeconds: canonicalTaskTimeoutSeconds[taskId],
  maxScore,
  description:
    "Build a transactional event-sourced inventory engine with concurrency, idempotency, replay, and tamper detection",
  files: readFixtureFiles(taskId, agentHiddenFiles),
  prompt: `Implement the complete production-quality event-sourced inventory engine described in README.md. Read every provided file first. Preserve README.md, package.json, tsconfig.json, and the contract test exactly. Keep event-log storage in src/store.ts, domain behavior in src/engine.ts, and exports in src/index.ts; additional focused modules are allowed. Pay particular attention to exact idempotency, atomic multi-SKU rollback, optimistic concurrency within batches, deep immutability, deterministic hash-chained JSONL, rigorous replay validation, and continuation after restore. Add substantial meaningful tests of your own. Use only Node built-ins and the existing toolchain; do not install dependencies. Run npm test and npm run typecheck until both pass. When all requirements and tests pass, create finish_notes.md summarizing your verification before concluding.`,
  verify(workspace, baseline, _finalText, context) {
    if (context?.evaluator) {
      if (hashSnapshotDirectory(context.evaluator.path) !== context.evaluator.sha256) {
        throw new Error("Evaluator freeze fixtures tampered before verification");
      }
    }
    const preservedFiles = ["README.md", "package.json", "tsconfig.json", "test/inventory.contract.test.ts"];
    const preserved = preservedFiles.every((file) => readWorkspaceText(join(workspace, file)) === baseline[file]);
    const sourceFiles = ["src/index.ts", "src/engine.ts", "src/store.ts"].every((file) =>
      existsSync(join(workspace, file)),
    );
    const testRoot = join(workspace, "test");
    const testFiles = existsSync(testRoot)
      ? listFixtureFiles(testRoot).filter((file) => file !== "inventory.contract.test.ts")
      : [];
    const addedTests = testFiles.some((file) =>
      /(test|it|describe)\(/.test(readWorkspaceText(join(testRoot, file)) ?? ""),
    );
    const visibleTestsPass = runFixtureCommand(workspace, ["test"]).status === 0;
    const typecheckPasses = runFixtureCommand(workspace, ["run", "typecheck"]).status === 0;
    const fixturesRoot = context?.evaluatorFixturesRoot;
    const rubric = fixturesRoot ? readHiddenRubric(taskId, fixturesRoot) : inventoryHiddenRubric;
    const hidden = runHiddenVerification(
      workspace,
      "inventory.hidden.test.ts",
      readFixtureText(taskId, "hidden.test.ts", fixturesRoot),
      "inventory",
      rubric,
    );
    const expectedMax = fixturesRoot ? 23 + rubric.reduce((sum, item) => sum + item.weight, 0) : maxScore;
    return createTaskResult(
      preserved && sourceFiles && addedTests && visibleTestsPass && typecheckPasses && hidden.passed,
      [
        { name: "README, config, and contract preserved", passed: preserved, weight: 2 },
        { name: "index, engine, and store modules exist", passed: sourceFiles, weight: 5 },
        { name: "agent added substantial inventory tests", passed: addedTests, weight: 2 },
        { name: "visible npm test passes", passed: visibleTestsPass, weight: 8 },
        { name: "npm run typecheck passes", passed: typecheckPasses, weight: 6 },
        ...hidden.checks,
      ],
      expectedMax,
    );
  },
};
