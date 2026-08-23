import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRuntimeSnapshot, hashRuntimeSnapshot } from "./benchmark-runtime-snapshot.js";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];

function writeRuntimeFixture(root) {
  mkdirSync(join(root, "node_modules", "dependency"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dependency", "index.js"), "export {};\n");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "benchmark-project-instruction-probe.js"), "export {};\n");
  writeFileSync(join(root, "scripts", "benchmark-project-instruction-seed.js"), "export {};\n");
  writeFileSync(join(root, "scripts", "benchmark-agents.js"), "export {};\n");
  writeFileSync(
    join(root, "scripts", "benchmark-project-instructions.js"),
    'import "./benchmark-project-instructions-schedule.js";\n',
  );
  writeFileSync(join(root, "scripts", "benchmark-project-instructions-schedule.js"), 'export const marker = "first";\n');
  for (const pkg of runtimePackages) {
    mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify({ name: pkg })}\n`);
    writeFileSync(join(root, "packages", pkg, "dist", "index.js"), "export {};\n");
  }
  const fixture = join(root, "benchmarks", "fixtures", "durable-workflow");
  mkdirSync(fixture, { recursive: true });
  for (const file of ["requirements.md", "contract.test.ts", "hidden.test.ts", "rubric.json"]) {
    writeFileSync(join(fixture, file), "{}\n");
  }
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
      join(root, "scripts", "benchmark-project-instructions-schedule.js"),
      'export const marker = "changed";\n',
    );
    const secondSnapshot = createRuntimeSnapshot(root, snapshotParent);
    const secondFingerprint = hashRuntimeSnapshot(secondSnapshot, process.execPath);

    assert.notEqual(
      secondFingerprint,
      firstFingerprint,
      "candidate-bound fingerprint must change when a paired benchmark harness dependency changes",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});
