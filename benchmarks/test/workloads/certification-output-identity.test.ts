import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertCertifiedOutputWritePath } from "../../src/harness/certified-output-integrity.ts";
import { createBenchmarkOutputPath } from "../../src/workloads/benchmark-output.ts";
import { publishBenchmarkResults } from "../../src/workloads/result-publication.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const certifiedArgs = [
  "--certified",
  "--model",
  "surface/model",
  "--expected-resolved-model",
  "backend/model",
  "--runs",
  "3",
];

test("certified publication rejects output-root replacement without writing through the replacement", () => {
  const parent = mkdtempSync(join(tmpdir(), "output-root-identity-"));
  const external = mkdtempSync(join(tmpdir(), "output-root-external-"));
  const output = join(parent, "output");
  const moved = join(parent, "moved-output");
  try {
    createBenchmarkOutputPath(parseRunnerArgs([...certifiedArgs, "--output", output]));
    renameSync(output, moved);
    symlinkSync(external, output, "dir");
    assert.throws(
      () => publishBenchmarkResults(join(output, "results.json"), { secret: true }, true),
      /identity|symbolic/u,
    );
    assert.equal(existsSync(join(external, "results.json")), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("certified publication rejects ancestor replacement without writing outside the bound tree", () => {
  const grandparent = mkdtempSync(join(tmpdir(), "output-ancestor-identity-"));
  const external = mkdtempSync(join(tmpdir(), "output-ancestor-external-"));
  const parent = join(grandparent, "parent");
  const moved = join(grandparent, "moved-parent");
  const output = join(parent, "output");
  try {
    mkdirSync(parent);
    createBenchmarkOutputPath(parseRunnerArgs([...certifiedArgs, "--output", output]));
    renameSync(parent, moved);
    symlinkSync(external, parent, "dir");
    assert.throws(
      () => publishBenchmarkResults(join(output, "results.json"), { secret: true }, true),
      /identity|symbolic/u,
    );
    assert.equal(existsSync(join(external, "output", "results.json")), false);
  } finally {
    rmSync(grandparent, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("certified output rejects hard-linked publication targets without modifying the external inode", () => {
  const parent = mkdtempSync(join(tmpdir(), "output-hardlink-identity-"));
  const external = join(parent, "external.txt");
  const output = join(parent, "output");
  try {
    writeFileSync(external, "external remains unchanged\n");
    createBenchmarkOutputPath(parseRunnerArgs([...certifiedArgs, "--output", output]));
    const target = join(output, "report.md");
    linkSync(external, target);
    assert.throws(() => assertCertifiedOutputWritePath(target, true), /unsafe target/u);
    assert.equal(readFileSync(external, "utf8"), "external remains unchanged\n");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
