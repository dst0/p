import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createBenchmarkEvaluationFreeze,
  verifyBenchmarkEvaluationSnapshot,
} from "../../src/harness/evaluation-freeze.ts";
import { hashRuntimeSnapshot } from "../../src/harness/runtime-snapshot.ts";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];

function writeEvaluationFixture(root: string): void {
  mkdirSync(join(root, "node_modules", "dependency"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dependency", "index.js"), "export {};\n");
  const sourceRoot = join(root, "benchmarks", "src");
  mkdirSync(join(sourceRoot, "harness"), { recursive: true });
  mkdirSync(join(sourceRoot, "project-instructions"), { recursive: true });
  for (const [path, contents] of [
    ["run-agents.ts", "export {};\n"],
    ["run-project-instructions.ts", "export {};\n"],
    ["harness/seed-helper-process.ts", "export {};\n"],
    ["project-instructions/probe.ts", "export {};\n"],
    ["project-instructions/seed.ts", "export {};\n"],
  ] as const) {
    const destination = join(sourceRoot, path);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, contents);
  }
  for (const pkg of runtimePackages) {
    mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify({ name: pkg })}\n`);
    writeFileSync(join(root, "packages", pkg, "dist", "index.js"), "export {};\n");
  }
  const fixture = join(root, "benchmarks", "fixtures", "task");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "requirements.md"), "public contract\n");
  writeFileSync(join(fixture, "hidden.test.ts"), "export const hidden = true;\n");
  writeFileSync(join(fixture, "rubric.json"), '[{"id":"hidden","name":"hidden","weight":1}]\n');
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(root, "package-lock.json"), "{}\n");
}

test("evaluation freeze separates public candidate bytes from hidden evaluator bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-evaluation-source-"));
  const parent = mkdtempSync(join(tmpdir(), "benchmark-evaluation-freeze-"));
  let freeze: ReturnType<typeof createBenchmarkEvaluationFreeze> | undefined;
  try {
    writeEvaluationFixture(root);
    freeze = createBenchmarkEvaluationFreeze(root, parent, process.execPath);
    const candidateFixture = join(freeze.candidateRuntimePath, "benchmarks", "fixtures", "task");
    const evaluatorFixture = join(freeze.evaluator.path, "benchmarks", "fixtures", "task");
    assert.equal(readFileSync(join(candidateFixture, "requirements.md"), "utf8"), "public contract\n");
    assert.equal(existsSync(join(candidateFixture, "hidden.test.ts")), false);
    assert.equal(existsSync(join(candidateFixture, "rubric.json")), false);
    assert.equal(readFileSync(join(evaluatorFixture, "hidden.test.ts"), "utf8"), "export const hidden = true;\n");
    assert.equal(existsSync(join(evaluatorFixture, "rubric.json")), true);
    assert.equal(existsSync(join(evaluatorFixture, "requirements.md")), false);
    assert.equal(statSync(freeze.evaluator.path).mode & 0o777, 0o700);
    assert.equal(verifyBenchmarkEvaluationSnapshot(freeze.evaluator), true);
    const candidateHash = hashRuntimeSnapshot(freeze.candidateRuntimePath, process.execPath);
    assert.equal(candidateHash, freeze.candidateRuntimeSha256);
    writeFileSync(join(evaluatorFixture, "hidden.test.ts"), "mutated hidden oracle\n");
    assert.equal(verifyBenchmarkEvaluationSnapshot(freeze.evaluator), false);
    assert.equal(hashRuntimeSnapshot(freeze.candidateRuntimePath, process.execPath), candidateHash);
  } finally {
    freeze?.dispose();
    rmSync(root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});
