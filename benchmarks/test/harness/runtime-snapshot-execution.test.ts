import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  benchmarkProjectInstructionProbePath,
  benchmarkSeedHelperPath,
  createRuntimeSnapshot,
  hashRuntimeSnapshot,
} from "../../src/harness/runtime-snapshot.ts";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function writeWorkspaceRuntime(root: string): void {
  mkdirSync(join(root, "node_modules", "@dst0"), { recursive: true });
  symlinkSync("../../packages/coding-agent", join(root, "node_modules", "@dst0", "p"));
  symlinkSync("../../packages/site", join(root, "node_modules", "@dst0", "p-site"));
  const sourceRoot = join(root, "benchmarks", "src");
  mkdirSync(join(sourceRoot, "harness"), { recursive: true });
  mkdirSync(join(sourceRoot, "project-instructions"), { recursive: true });
  writeFileSync(join(sourceRoot, "run-agents.ts"), "export {};\n");
  writeFileSync(join(sourceRoot, "run-project-instructions.ts"), "export {};\n");
  writeFileSync(join(sourceRoot, "harness", "seed-helper-process.ts"), "export {};\n");
  writeFileSync(
    join(sourceRoot, "project-instructions", "probe.ts"),
    'import { value } from "@dst0/p"; process.stdout.write(value);\n',
  );
  writeFileSync(join(sourceRoot, "project-instructions", "seed.ts"), "export {};\n");
  for (const pkg of runtimePackages) {
    mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
    const manifest =
      pkg === "coding-agent" ? { name: "@dst0/p", type: "module", exports: "./dist/index.js" } : { name: pkg };
    writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify(manifest)}\n`);
    const contents = pkg === "coding-agent" ? 'export const value = "snapshot";\n' : `export const name = "${pkg}";\n`;
    writeFileSync(join(root, "packages", pkg, "dist", "index.js"), contents);
  }
  mkdirSync(join(root, "benchmarks", "fixtures", "task"), { recursive: true });
  writeFileSync(join(root, "benchmarks", "fixtures", "task", "requirements.md"), "fixture\n");
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(root, "package-lock.json"), "{}\n");
}

test("runtime snapshot executes immutable workspace dependencies and detects direct tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-workspace-source-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-workspace-copy-"));
  try {
    writeWorkspaceRuntime(root);
    const snapshot = createRuntimeSnapshot(root, snapshotParent);
    const copiedDist = join(snapshot, "packages", "coding-agent", "dist", "index.js");
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
    writeFileSync(copiedDist, 'export const value = "tampered";\n');
    assert.notEqual(hashRuntimeSnapshot(snapshot, process.execPath), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
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
