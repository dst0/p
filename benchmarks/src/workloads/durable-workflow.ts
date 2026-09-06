import { existsSync } from "node:fs";
import { join } from "node:path";
import { listFixtureFiles, readFixtureText, readWorkspaceText } from "./fixture-files.ts";
import { runFixtureCommand } from "./fixture-verification.ts";
import { runHiddenVerification } from "./hidden-verification.ts";
import { readHiddenRubric } from "./rubric.ts";
import { type BenchmarkTask, createTaskResult } from "./task-definition.ts";

const taskId = "durable-workflow-saga";
const fixtureId = "durable-workflow";
const maxScore = 158;
export const workflowHiddenRubric = readHiddenRubric(fixtureId);

export const durableWorkflowTask: BenchmarkTask = {
  id: taskId,
  timeoutSeconds: 3600,
  maxScore,
  description:
    "Build a deterministic durable workflow and saga engine with DAG scheduling, fenced leases, retries, compensation, and tamper-evident recovery",
  files: {
    "README.md": readFixtureText(fixtureId, "requirements.md"),
    "package.json": readFixtureText(fixtureId, "package.json"),
    "tsconfig.json": readFixtureText(fixtureId, "tsconfig.json"),
    "test/workflow.contract.test.ts": readFixtureText(fixtureId, "contract.test.ts"),
  },
  prompt: `Implement the complete production-quality durable workflow and saga engine described in README.md. Read every supplied file first and preserve README.md, package.json, tsconfig.json, and the contract test exactly. Keep orchestration in src/engine.ts, deterministic scheduling and fenced leases in src/scheduler.ts, durable hash-chained log validation in src/store.ts, and public exports in src/index.ts. Pay particular attention to full DAG validation, global command idempotency, virtual-time retry backoff, stale lease fencing, reverse-order compensation, deep immutability, deterministic JSONL, adversarial restore validation, and exact continuation after restore. Add substantial meaningful tests of your own. Use only Node built-ins and the existing toolchain; do not install dependencies. Run npm test and npm run typecheck until both pass. When all requirements and tests pass, create finish_notes.md summarizing your verification before concluding.`,
  verify(workspace, baseline) {
    const preservedFiles = ["README.md", "package.json", "tsconfig.json", "test/workflow.contract.test.ts"];
    const preserved = preservedFiles.every((file) => readWorkspaceText(join(workspace, file)) === baseline[file]);
    const sourceFiles = ["src/index.ts", "src/engine.ts", "src/scheduler.ts", "src/store.ts"].every((file) =>
      existsSync(join(workspace, file)),
    );
    const testRoot = join(workspace, "test");
    const testFiles = existsSync(testRoot)
      ? listFixtureFiles(testRoot).filter((file) => file !== "workflow.contract.test.ts")
      : [];
    const addedTests = testFiles.some((file) =>
      /(test|it|describe)\(/.test(readWorkspaceText(join(testRoot, file)) ?? ""),
    );
    const visibleTestsPass = runFixtureCommand(workspace, ["test"]).status === 0;
    const typecheckPasses = runFixtureCommand(workspace, ["run", "typecheck"]).status === 0;
    const hidden = runHiddenVerification(
      workspace,
      "workflow.hidden.test.ts",
      readFixtureText(fixtureId, "hidden.test.ts"),
      "workflow",
      workflowHiddenRubric,
    );
    return createTaskResult(
      preserved && sourceFiles && addedTests && visibleTestsPass && typecheckPasses && hidden.passed,
      [
        { name: "README, config, and contract preserved", passed: preserved, weight: 3 },
        { name: "index, engine, scheduler, and store modules exist", passed: sourceFiles, weight: 8 },
        { name: "agent added substantial workflow tests", passed: addedTests, weight: 3 },
        { name: "visible npm test passes", passed: visibleTestsPass, weight: 10 },
        { name: "npm run typecheck passes", passed: typecheckPasses, weight: 8 },
        ...hidden.checks,
      ],
      maxScore,
    );
  },
};
