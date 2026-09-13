import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertBenchmarkContainment,
  benchmarkSandboxExecutable,
  createBenchmarkSandboxProfile,
  createSandboxedBenchmarkCommand,
} from "../../src/harness/benchmark-isolation.ts";
import { createCandidateRuntimeSnapshot } from "../../src/harness/runtime-snapshot.ts";

test(
  "containment rejects live repo, evaluator reads, outside writes, and runtime mutation",
  { skip: !benchmarkSandboxExecutable() },
  () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "containment-proof-")));
    const liveRepo = join(root, "live-repo");
    const workspace = join(root, "workspace");
    const runtime = join(root, "candidate-runtime");
    const evaluator = join(root, "evaluator-freeze");
    const outside = join(root, "outside");
    mkdirSync(liveRepo);
    mkdirSync(workspace);
    mkdirSync(runtime);
    mkdirSync(evaluator);
    mkdirSync(outside);

    try {
      writeFileSync(join(liveRepo, "live.txt"), "live content\n");
      writeFileSync(join(evaluator, "hidden.test.ts"), "hidden test content\n");
      writeFileSync(join(evaluator, "rubric.json"), "[]\n");
      writeFileSync(join(runtime, "runtime.txt"), "runtime content\n");

      const profile = createBenchmarkSandboxProfile({ workspace, runtime });
      assert.equal(profile.includes(liveRepo), false);
      assert.equal(profile.includes(evaluator), false);
      assert.equal(profile.includes(outside), false);
      assert.equal(profile.includes('(subpath "/opt/homebrew/etc")'), false);
      assert.equal(profile.includes('(subpath "/Users")'), false);

      const probe = join(workspace, "malicious-probe.js");
      writeFileSync(
        probe,
        'import fs from "node:fs";\n' +
          "const [action, target, content] = process.argv.slice(2);\n" +
          'if (action === "read") process.stdout.write(fs.readFileSync(target, "utf8"));\n' +
          'if (action === "write") fs.writeFileSync(target, content ?? "tampered");\n',
      );

      const runProbe = (action: string, target: string, content?: string) => {
        const probeArgs = [probe, action, target];
        if (content) probeArgs.push(content);
        const cmd = createSandboxedBenchmarkCommand({ workspace, runtime }, process.execPath, probeArgs);
        return spawnSync(cmd.executable, cmd.args, {
          cwd: workspace,
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
        });
      };

      const allowedRead = runProbe("read", join(runtime, "runtime.txt"));
      assert.equal(allowedRead.status, 0);
      assert.equal(allowedRead.stdout, "runtime content\n");

      const allowedWrite = runProbe("write", join(workspace, "valid.txt"), "valid");
      assert.equal(allowedWrite.status, 0);

      assert.notEqual(runProbe("read", join(liveRepo, "live.txt")).status, 0);
      assert.notEqual(runProbe("read", join(evaluator, "hidden.test.ts")).status, 0);
      assert.notEqual(runProbe("read", join(evaluator, "rubric.json")).status, 0);
      assert.notEqual(runProbe("write", join(outside, "tampered.txt")).status, 0);
      assert.notEqual(runProbe("write", join(evaluator, "tampered.txt")).status, 0);
      assert.notEqual(runProbe("write", join(runtime, "tampered.txt")).status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("candidate runtime snapshot excludes hidden test and rubric fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "candidate-snapshot-fixtures-"));
  const mockRepo = join(root, "mock-repo");
  mkdirSync(join(mockRepo, "node_modules"), { recursive: true });
  mkdirSync(join(mockRepo, "benchmarks", "src", "project-instructions"), { recursive: true });
  mkdirSync(join(mockRepo, "benchmarks", "src", "harness"), { recursive: true });
  mkdirSync(join(mockRepo, "benchmarks", "fixtures", "calc"), { recursive: true });
  for (const pkg of ["ai", "tui", "agent", "code-index", "coding-agent", "site"]) {
    mkdirSync(join(mockRepo, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(mockRepo, "packages", pkg, "package.json"), "{}");
  }

  try {
    writeFileSync(join(mockRepo, "package.json"), "{}");
    writeFileSync(join(mockRepo, "package-lock.json"), "{}");
    writeFileSync(join(mockRepo, "benchmarks", "src", "run-agents.ts"), "export {};");
    writeFileSync(join(mockRepo, "benchmarks", "src", "run-project-instructions.ts"), "export {};");
    writeFileSync(join(mockRepo, "benchmarks", "src", "project-instructions", "probe.ts"), "export {};");
    writeFileSync(join(mockRepo, "benchmarks", "src", "project-instructions", "seed.ts"), "export {};");
    writeFileSync(join(mockRepo, "benchmarks", "src", "harness", "seed-helper-process.ts"), "export {};");

    writeFileSync(join(mockRepo, "benchmarks", "fixtures", "calc", "calc.ts"), "visible\n");
    writeFileSync(join(mockRepo, "benchmarks", "fixtures", "calc", "hidden.test.ts"), "hidden\n");
    writeFileSync(join(mockRepo, "benchmarks", "fixtures", "calc", "rubric.json"), "{}\n");

    const snapshot = createCandidateRuntimeSnapshot(mockRepo, root);
    const visibleFile = join(snapshot, "benchmarks", "fixtures", "calc", "calc.ts");
    const hiddenFile = join(snapshot, "benchmarks", "fixtures", "calc", "hidden.test.ts");
    const rubricFile = join(snapshot, "benchmarks", "fixtures", "calc", "rubric.json");

    assert.equal(existsSync(visibleFile), true);
    assert.equal(existsSync(hiddenFile), false);
    assert.equal(existsSync(rubricFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertBenchmarkContainment enforces containment boundaries and fails closed", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "containment-bounds-")));
  const repo = join(root, "repo");
  const evaluator = join(root, "evaluator");
  const workspace = join(root, "ws");
  const runtime = join(root, "rt");
  const subRepoInsideWs = join(workspace, "nested-repo");
  const subEvalInsideRt = join(runtime, "nested-eval");
  mkdirSync(repo);
  mkdirSync(evaluator);
  mkdirSync(workspace);
  mkdirSync(runtime);
  mkdirSync(subRepoInsideWs);
  mkdirSync(subEvalInsideRt);

  try {
    assert.doesNotThrow(() =>
      assertBenchmarkContainment({ workspace, runtime }, { repoRoot: repo, evaluatorPath: evaluator }),
    );

    assert.throws(
      () => assertBenchmarkContainment({ workspace: repo, runtime }, { repoRoot: repo, evaluatorPath: evaluator }),
      /Benchmark workspace escapes containment into repo or evaluator/u,
    );
    assert.throws(
      () => assertBenchmarkContainment({ workspace, runtime: evaluator }, { repoRoot: repo, evaluatorPath: evaluator }),
      /Candidate runtime escapes containment into repo or evaluator/u,
    );
    assert.throws(
      () => assertBenchmarkContainment({ workspace, runtime }, { repoRoot: subRepoInsideWs, evaluatorPath: evaluator }),
      /Live repository is accessible inside benchmark candidate containment/u,
    );
    assert.throws(
      () => assertBenchmarkContainment({ workspace, runtime }, { repoRoot: repo, evaluatorPath: subEvalInsideRt }),
      /Evaluator freeze is accessible inside benchmark candidate containment/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
