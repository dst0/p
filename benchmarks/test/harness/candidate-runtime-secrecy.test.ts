import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  benchmarkProjectInstructionProbePath,
  createCandidateRuntimeSnapshot,
} from "../../src/harness/runtime-snapshot.ts";

const packages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];

function writeFixture(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function createSourceFixture(root: string): void {
  writeFixture(root, "package.json", '{"type":"module"}\n');
  writeFixture(root, "package-lock.json", "{}\n");
  writeFixture(root, "node_modules/dependency/index.js", "export {};\n");
  writeFixture(root, "benchmarks/fixtures/task/requirements.md", "Implement the requested behavior.\n");
  writeFixture(root, "benchmarks/fixtures/task/hidden.test.ts", "export const privateOracle = true;\n");
  writeFixture(root, "benchmarks/fixtures/task/rubric.json", "{}\n");
  writeFixture(root, "benchmarks/src/workloads/evaluator-plan.ts", "export const privatePlan = true;\n");
  writeFixture(root, "benchmarks/src/run-agents.ts", 'import "./workloads/evaluator-plan.ts";\n');
  writeFixture(root, "benchmarks/src/run-project-instructions.ts", "export {};\n");
  writeFixture(root, "benchmarks/src/harness/seed-helper-process.ts", "export {};\n");
  writeFixture(root, "benchmarks/src/project-instructions/seed.ts", "export {};\n");
  writeFixture(root, "benchmarks/src/project-instructions/probe-helper.ts", 'export const result = "probe";\n');
  writeFixture(
    root,
    "benchmarks/src/project-instructions/probe.ts",
    'import { result } from "./probe-helper.ts"; process.stdout.write(result);\n',
  );
  for (const pkg of packages) {
    writeFixture(root, `packages/${pkg}/package.json`, `${JSON.stringify({ name: pkg })}\n`);
    writeFixture(root, `packages/${pkg}/dist/index.js`, "export {};\n");
  }
  writeFixture(root, "packages/coding-agent/dist/cli.js", "process.stdout.write('candidate cli');\n");
}

test("candidate snapshot excludes evaluator runner closure but retains executable runtime and probe", () => {
  const source = mkdtempSync(join(tmpdir(), "candidate-runtime-source-"));
  const parent = mkdtempSync(join(tmpdir(), "candidate-runtime-copy-"));
  try {
    createSourceFixture(source);
    const snapshot = createCandidateRuntimeSnapshot(source, parent);
    assert.equal(existsSync(join(snapshot, "benchmarks/src/run-agents.ts")), false);
    assert.equal(existsSync(join(snapshot, "benchmarks/src/workloads/evaluator-plan.ts")), false);
    assert.equal(existsSync(join(snapshot, "benchmarks/fixtures/task/hidden.test.ts")), false);
    assert.equal(existsSync(join(snapshot, "benchmarks/fixtures/task/rubric.json")), false);
    assert.equal(existsSync(join(snapshot, "benchmarks/fixtures/task/requirements.md")), true);
    for (const [path, stdout] of [
      [join(snapshot, "packages/coding-agent/dist/cli.js"), "candidate cli"],
      [benchmarkProjectInstructionProbePath(snapshot), "probe"],
    ] as const) {
      const run = spawnSync(process.execPath, [path], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, stdout);
    }
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("candidate probe cannot transitively import evaluator-only modules", () => {
  const source = mkdtempSync(join(tmpdir(), "candidate-import-source-"));
  const parent = mkdtempSync(join(tmpdir(), "candidate-import-copy-"));
  try {
    createSourceFixture(source);
    writeFixture(
      source,
      "benchmarks/src/project-instructions/probe-helper.ts",
      'import "../workloads/evaluator-plan.ts";\n',
    );
    assert.throws(() => createCandidateRuntimeSnapshot(source, parent), /Candidate.*import.*outside/u);
    assert.deepEqual(readdirSync(parent), []);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});
