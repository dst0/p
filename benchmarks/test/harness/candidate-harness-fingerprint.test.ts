import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRuntimeSnapshot, hashRuntimeSnapshot } from "../../src/harness/runtime-snapshot.ts";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];

function writeRuntimeFixture(root: string): void {
  mkdirSync(join(root, "node_modules", "dependency"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dependency", "index.js"), "export {};\n");
  const source = join(root, "benchmarks", "src");
  mkdirSync(join(source, "harness"), { recursive: true });
  mkdirSync(join(source, "project-instructions"), { recursive: true });
  writeFileSync(join(source, "run-agents.ts"), "export {};\n");
  writeFileSync(join(source, "harness", "seed-helper-process.ts"), "export {};\n");
  writeFileSync(join(source, "project-instructions", "probe.ts"), "export {};\n");
  writeFileSync(join(source, "project-instructions", "seed.ts"), "export {};\n");
  writeFileSync(join(source, "run-project-instructions.ts"), 'import "./project-instructions/run-schedule.ts";\n');
  writeFileSync(join(source, "project-instructions", "run-schedule.ts"), 'export const marker = "first";\n');
  for (const pkg of runtimePackages) {
    mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify({ name: pkg })}\n`);
    writeFileSync(join(root, "packages", pkg, "dist", "index.js"), "export {};\n");
  }
  const fixture = join(root, "benchmarks", "fixtures", "durable-workflow");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "requirements.md"), "{}\n");
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
}

test("candidate fingerprint includes the top-level paired benchmark harness closure", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-harness-source-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-harness-snapshots-"));
  try {
    writeRuntimeFixture(root);
    const firstSnapshot = createRuntimeSnapshot(root, snapshotParent);
    const firstFingerprint = hashRuntimeSnapshot(firstSnapshot, process.execPath);
    writeFileSync(
      join(root, "benchmarks", "src", "project-instructions", "run-schedule.ts"),
      'export const marker = "changed";\n',
    );
    const secondSnapshot = createRuntimeSnapshot(root, snapshotParent);
    assert.notEqual(hashRuntimeSnapshot(secondSnapshot, process.execPath), firstFingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});
