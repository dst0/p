import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";

const documentedArgs = [
  "--certified",
  "--model",
  "surface/model",
  "--expected-resolved-model",
  "backend/model",
  "--runs",
  "3",
];

test("documented certified arguments derive a deadline covering every cell and preflight", () => {
  const options = parseRunnerArgs(documentedArgs);
  const taskBudget = benchmarkTasks.reduce((total, task) => total + task.timeoutSeconds, 0);
  const taskSeconds = taskBudget * options.agents.length * options.runs;
  const preflightSeconds = 60 * options.agents.length;
  const kiloStartupSeconds = options.kiloStartupTimeoutSeconds;
  const orchestrationSeconds = 300 + 30 * options.agents.length * options.runs * benchmarkTasks.length;
  assert.equal(options.maxRuntimeSeconds, taskSeconds + preflightSeconds + kiloStartupSeconds + orchestrationSeconds);
});

test("certified deadline scales minimum task timeouts, runs, and Kilo startup independently", () => {
  const options = parseRunnerArgs([
    ...documentedArgs,
    "--runs",
    "4",
    "--minimum-timeout-seconds",
    "4000",
    "--kilo-startup-timeout-seconds",
    "123",
  ]);
  const cells = options.agents.length * options.runs * benchmarkTasks.length;
  assert.equal(options.maxRuntimeSeconds, 4000 * cells + 60 * options.agents.length + 123 + 300 + 30 * cells);
});

test("certified mode rejects an explicitly inadequate global deadline", () => {
  assert.throws(
    () => parseRunnerArgs([...documentedArgs, "--max-runtime-seconds", "900"]),
    /max-runtime-seconds.*at least/iu,
  );
});
