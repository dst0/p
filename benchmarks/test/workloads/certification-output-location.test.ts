import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import { createBenchmarkWorkspace } from "../../src/harness/workspace-repository.ts";
import { createBenchmarkOutputPath } from "../../src/workloads/benchmark-output.ts";
import { publishBenchmarkResults } from "../../src/workloads/result-publication.ts";
import { parseRunnerArgs, repoRoot } from "../../src/workloads/runner-options.ts";

test("certified default output is created outside the live repository containment boundary", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "surface/model",
    "--expected-resolved-model",
    "backend/model",
    "--runs",
    "3",
  ]);
  const output = createBenchmarkOutputPath(options);
  try {
    const fromRepo = relative(realpathSync(repoRoot), realpathSync(output));
    assert.equal(fromRepo === "" || (!fromRepo.startsWith("..") && !fromRepo.startsWith("/")), false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("an explicit output path remains authoritative", () => {
  const parent = mkdtempSync(join(tmpdir(), "benchmark-explicit-output-"));
  try {
    const explicit = join(parent, "results");
    const options = parseRunnerArgs(["--model", "surface/model", "--output", explicit]);
    assert.equal(createBenchmarkOutputPath(options), explicit);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("certified explicit output is private, empty, and not a symlink before any publication", () => {
  const parent = mkdtempSync(join(tmpdir(), "certified-explicit-output-"));
  const args = ["--certified", "--model", "surface/model", "--expected-resolved-model", "backend/model", "--runs", "3"];
  try {
    const fresh = join(parent, "fresh");
    const freshOptions = parseRunnerArgs([...args, "--output", fresh]);
    assert.equal(createBenchmarkOutputPath(freshOptions), fresh);
    assert.equal(lstatSync(fresh).mode & 0o777, 0o700);
    const owner = join(fresh, ".p-benchmark-owner");
    assert.equal(lstatSync(owner).mode & 0o777, 0o600);
    assert.throws(() => createBenchmarkOutputPath(freshOptions), /empty|exist/u);
    const nonempty = join(parent, "nonempty");
    mkdirSync(join(nonempty, "workspaces", "p", "run-1", "typescript-calculator"), {
      recursive: true,
      mode: 0o700,
    });
    chmodSync(nonempty, 0o700);
    writeFileSync(join(nonempty, "workspaces", "p", "run-1", "typescript-calculator", "solution.ts"), "solution");
    assert.throws(() => createBenchmarkOutputPath(parseRunnerArgs([...args, "--output", nonempty])), /empty/u);
    const permissive = join(parent, "permissive");
    mkdirSync(permissive, { mode: 0o700 });
    chmodSync(permissive, 0o755);
    assert.throws(() => createBenchmarkOutputPath(parseRunnerArgs([...args, "--output", permissive])), /0700/u);
    const link = join(parent, "link");
    symlinkSync(fresh, link);
    assert.throws(() => createBenchmarkOutputPath(parseRunnerArgs([...args, "--output", link])), /symbolic link/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("certified results publication is private and exclusive", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-exclusive-publication-"));
  try {
    const resultPath = join(root, "results.json");
    bindCertifiedOutputRoot(root);
    publishBenchmarkResults(resultPath, { fresh: true }, true);
    assert.equal(lstatSync(resultPath).mode & 0o777, 0o600);
    assert.throws(() => publishBenchmarkResults(resultPath, { overwritten: true }, true), /exist/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a certified task workspace cannot reuse a preseeded cell directory", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-preseeded-cell-"));
  const workspace = join(root, "workspaces", "p", "run-1", "task");
  try {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "solution.ts"), "preseeded");
    assert.throws(
      () =>
        createBenchmarkWorkspace(
          root,
          "p",
          1,
          { id: "task", files: { "solution.ts": "trusted" } },
          {
            certified: true,
            projectInstructionsFile: join(root, "AGENTS.md"),
          },
        ),
      /exist/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
