import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertEmptyOutputDirectory,
  benchmarkProjectInstructionProbePath,
  benchmarkRunnerPath,
  benchmarkSeedHelperPath,
  createRuntimeSnapshot,
  hashRuntimeSnapshot,
  snapshotBenchmarkRunnerClosure,
} from "./benchmark-runtime-snapshot.js";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function writeDurableWorkflowFixture(root) {
  const fixture = join(root, "benchmarks", "fixtures", "durable-workflow");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "requirements.md"), "snapshot requirements\n");
  writeFileSync(join(fixture, "contract.test.ts"), "export {};\n");
  writeFileSync(join(fixture, "hidden.test.ts"), "export {};\n");
  writeFileSync(join(fixture, "rubric.json"), "{}\n");
}

function writeBenchmarkOrchestrator(root) {
  writeFileSync(join(root, "scripts", "benchmark-project-instructions.js"), "export {};\n");
}

test("runtime snapshot is independent from its source and detects snapshot mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-source-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-copy-"));
  try {
    mkdirSync(join(root, "node_modules", "dependency"), { recursive: true });
    writeFileSync(join(root, "node_modules", "dependency", "index.js"), "export const value = 1;\n");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeBenchmarkOrchestrator(root);
    for (const file of [
      "benchmark-project-instruction-probe.js",
      "benchmark-project-instruction-marker.js",
      "benchmark-project-instruction-proof-ipc.js",
    ]) {
      writeFileSync(join(root, "scripts", file), readFileSync(join(repoRoot, "scripts", file)));
    }
    writeFileSync(join(root, "scripts", "benchmark-project-instruction-seed.js"), "process.stdout.write('seed snapshot');\n");
    writeFileSync(join(root, "scripts", "benchmark-runner-helper.js"), 'export const value = "snapshot";\n');
    writeFileSync(
      join(root, "scripts", "benchmark-agents.js"),
      'import { value } from "./benchmark-runner-helper.js"; const fixture = `import { fake } from "../src/fake.ts"`; process.stdout.write(value + fixture.slice(0, 0));\n',
    );
    for (const pkg of runtimePackages) {
      mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
      writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify({ name: pkg })}\n`);
      writeFileSync(join(root, "packages", pkg, "dist", "index.js"), `export const name = "${pkg}";\n`);
    }
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    writeDurableWorkflowFixture(root);
    const snapshot = createRuntimeSnapshot(root, snapshotParent);
    assert.equal(existsSync(benchmarkProjectInstructionProbePath(snapshot)), true);
    assert.equal(
      readFileSync(join(snapshot, "scripts", "benchmark-runner-helper.js"), "utf8"),
      'export const value = "snapshot";\n',
    );
    assert.equal(
      readFileSync(join(snapshot, "benchmarks", "fixtures", "durable-workflow", "requirements.md"), "utf8"),
      "snapshot requirements\n",
    );
    const before = hashRuntimeSnapshot(snapshot, process.execPath);
    writeFileSync(join(root, "packages", "coding-agent", "dist", "index.js"), "changed source\n");
    writeFileSync(join(root, "scripts", "benchmark-runner-helper.js"), 'export const value = "live";\n');
    writeFileSync(join(root, "scripts", "benchmark-project-instruction-seed.js"), "process.stdout.write('seed live');\n");
    writeFileSync(join(root, "scripts", "benchmark-project-instruction-marker.js"), 'throw new Error("live marker loaded");\n');
    writeFileSync(join(root, "benchmarks", "fixtures", "durable-workflow", "requirements.md"), "live\n");
    assert.equal(hashRuntimeSnapshot(snapshot, process.execPath), before);
    assert.equal(benchmarkRunnerPath(snapshot), join(snapshot, "scripts", "benchmark-agents.js"));
    assert.equal(benchmarkSeedHelperPath(snapshot), join(snapshot, "scripts", "benchmark-project-instruction-seed.js"));
    const execution = spawnSync(process.execPath, [benchmarkRunnerPath(snapshot)], {
      encoding: "utf8",
    });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, "snapshot");
    const seedExecution = spawnSync(process.execPath, [benchmarkSeedHelperPath(snapshot)], { encoding: "utf8" });
    assert.equal(seedExecution.stdout, "seed snapshot");
    const probeExecution = spawnSync(process.execPath, [benchmarkProjectInstructionProbePath(snapshot)], {
      encoding: "utf8",
    });
    assert.equal(probeExecution.status, 0, probeExecution.stderr);
    assert.equal(probeExecution.stdout, "");
    writeFileSync(join(snapshot, "scripts", "benchmark-runner-helper.js"), 'export const value = "changed";\n');
    assert.notEqual(hashRuntimeSnapshot(snapshot, process.execPath), before);
    writeFileSync(join(snapshot, "packages", "coding-agent", "dist", "index.js"), "changed snapshot\n");
    assert.notEqual(hashRuntimeSnapshot(snapshot, process.execPath), before);
    writeFileSync(join(root, "scripts", "benchmark-agents.js"), 'import "../outside.js";\n');
    assert.throws(() => createRuntimeSnapshot(root, snapshotParent), /runner import escapes/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});

test("runtime snapshot rejects escaping, nested, and unresolved symlinks", () => {
  for (const targetKind of ["absolute", "relative", "nested", "unresolved"]) {
    const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-symlink-source-"));
    const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-symlink-copy-"));
    try {
      mkdirSync(join(root, "node_modules", "dependency"), { recursive: true });
      let target = "../../../outside-runtime";
      if (targetKind === "absolute") target = join(root, "packages", "coding-agent");
      if (targetKind === "nested") {
        symlinkSync(join(root, "packages", "coding-agent"), join(root, "node_modules", "dependency", "inner"));
        target = "inner";
      }
      if (targetKind === "unresolved") target = "../../packages/missing";
      symlinkSync(target, join(root, "node_modules", "dependency", "escape"));
      mkdirSync(join(root, "scripts"), { recursive: true });
      writeBenchmarkOrchestrator(root);
      writeFileSync(join(root, "scripts", "benchmark-project-instruction-probe.js"), "export default () => {};\n");
      writeFileSync(join(root, "scripts", "benchmark-project-instruction-seed.js"), "export {};\n");
      writeFileSync(join(root, "scripts", "benchmark-agents.js"), "process.stdout.write('snapshot');\n");
      for (const pkg of runtimePackages) {
        mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
        writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify({ name: pkg })}\n`);
        writeFileSync(join(root, "packages", pkg, "dist", "index.js"), `export const name = "${pkg}";\n`);
      }
      writeFileSync(join(root, "package.json"), "{}\n");
      writeFileSync(join(root, "package-lock.json"), "{}\n");
      writeDurableWorkflowFixture(root);

      assert.throws(
        () => createRuntimeSnapshot(root, snapshotParent),
        /Runtime symlink (?:escapes|is unresolved inside|resolves outside) immutable runtime snapshot/u,
      );
      assert.deepEqual(readdirSync(snapshotParent), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshotParent, { recursive: true, force: true });
    }
  }
});

test("runtime snapshot executes workspace dependencies from the immutable snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-workspace-source-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-workspace-copy-"));
  try {
    mkdirSync(join(root, "node_modules", "@dst0"), { recursive: true });
    symlinkSync("../../packages/coding-agent", join(root, "node_modules", "@dst0", "p"));
    symlinkSync("../../packages/site", join(root, "node_modules", "@dst0", "p-site"));
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeBenchmarkOrchestrator(root);
    writeFileSync(
      join(root, "scripts", "benchmark-project-instruction-probe.js"),
      'import { value } from "@dst0/p"; process.stdout.write(value);\n',
    );
    writeFileSync(join(root, "scripts", "benchmark-project-instruction-seed.js"), "export {};\n");
    writeFileSync(join(root, "scripts", "benchmark-agents.js"), "process.stdout.write('snapshot');\n");
    for (const pkg of runtimePackages) {
      mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
      const manifest = pkg === "coding-agent"
        ? { name: "@dst0/p", type: "module", exports: "./dist/index.js" }
        : { name: pkg };
      writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify(manifest)}\n`);
      const contents = pkg === "coding-agent" ? 'export const value = "snapshot";\n' : `export const name = "${pkg}";\n`;
      writeFileSync(join(root, "packages", pkg, "dist", "index.js"), contents);
    }
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    writeDurableWorkflowFixture(root);

    const snapshot = createRuntimeSnapshot(root, snapshotParent);
    const before = hashRuntimeSnapshot(snapshot, process.execPath);
    assert.equal(
      readFileSync(join(snapshot, "node_modules", "@dst0", "p", "dist", "index.js"), "utf8"),
      'export const value = "snapshot";\n',
    );

    writeFileSync(join(root, "packages", "coding-agent", "dist", "index.js"), 'export const value = "live";\n');
    const execution = spawnSync(process.execPath, [benchmarkProjectInstructionProbePath(snapshot)], {
      encoding: "utf8",
    });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, "snapshot");
    assert.equal(hashRuntimeSnapshot(snapshot, process.execPath), before);
    assert.equal(readlinkSync(join(snapshot, "node_modules", "@dst0", "p")), "../../packages/coding-agent");
    assert.equal(readlinkSync(join(snapshot, "node_modules", "@dst0", "p-site")), "../../packages/site");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});

test("paired output must be absent or empty", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-output-check-"));
  try {
    assert.doesNotThrow(() => assertEmptyOutputDirectory(join(root, "missing")));
    assert.doesNotThrow(() => assertEmptyOutputDirectory(root));
    writeFileSync(join(root, "stale.json"), "{}\n");
    assert.throws(() => assertEmptyOutputDirectory(root), /not empty/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real benchmark runner and its local import closure can be snapshotted", () => {
  const snapshot = mkdtempSync(join(tmpdir(), "benchmark-real-runner-copy-"));
  try {
    snapshotBenchmarkRunnerClosure(repoRoot, snapshot);
    for (const file of [
      "benchmark-agents.js",
      "benchmark-agent-private-directories.js",
      "benchmark-auth-source.js",
      "benchmark-project-instruction-cache.js",
      "benchmark-project-instruction-marker.js",
      "benchmark-project-instruction-probe.js",
      "benchmark-p-recording.js",
      "benchmark-project-instruction-routing.js",
      "benchmark-project-instruction-seed.js",
      "benchmark-project-instruction-seed-record.js",
      "benchmark-project-instruction-validation.js",
      "benchmark-project-instructions.js",
      "benchmark-project-instructions-output.js",
      "benchmark-project-instructions-schedule.js",
      "benchmark-candidate-registry.js",
      "benchmark-candidate-version.js",
      "benchmark-workspace-repository.js",
    ]) {
      assert.equal(existsSync(join(snapshot, "scripts", file)), true);
    }
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
});

test("the real snapshotted seed helper executes through the macOS temporary-path alias", () => {
  const snapshot = createRuntimeSnapshot(repoRoot, tmpdir());
  try {
    const execution = spawnSync(process.execPath, [benchmarkSeedHelperPath(snapshot)], { encoding: "utf8" });
    assert.equal(execution.status, 86, execution.stderr);
    assert.deepEqual(JSON.parse(execution.stdout), {
      status: "failed",
      diagnostic: "project instruction compiler failed",
    });
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
});
