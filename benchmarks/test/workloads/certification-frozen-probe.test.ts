import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import { benchmarkProjectInstructionProbePath } from "../../src/harness/runtime-snapshot.ts";
import { setupCertifiedBenchmark } from "../../src/workloads/certification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test(
  "certified setup executes the project-instruction probe from the frozen candidate",
  { skip: process.platform !== "darwin" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "certified-frozen-probe-"));
    const repo = join(root, "repo");
    const output = join(root, "output");
    try {
      createMinimalBenchmarkRepository(repo);
      mkdirSync(output);
      bindCertifiedOutputRoot(output);
      const pi = createVersionExecutable(join(root, "pi-package"), "pi", "1.0.0");
      const kilo = createVersionExecutable(join(root, "kilo-package"), "kilo", "2.0.0");
      const options = parseRunnerArgs([
        "--certified",
        "--model",
        "surface/model",
        "--expected-resolved-model",
        "backend/model",
        "--runs",
        "3",
        "--pi-executable",
        pi,
        "--pi-version",
        "1.0.0",
        "--kilo-executable",
        kilo,
        "--kilo-version",
        "2.0.0",
        "--project-instructions-file",
        join(repo, "AGENTS.md"),
      ]);

      const setup = setupCertifiedBenchmark(options, { p: "0.4.0", pi: "1.0.0", kilo: "2.0.0" }, repo, output);
      try {
        assert.ok(setup.freeze);
        const expectedProbe = benchmarkProjectInstructionProbePath(setup.freeze.candidateRuntimePath);
        assert.equal(options.projectInstructionProbe, expectedProbe);
        assert.equal(existsSync(expectedProbe), true);
        assert.equal(options.projectInstructionProbe.startsWith(repo), false);
        assert.equal(options.piExecutable?.startsWith(setup.freeze.candidateRuntimePath), true);
        assert.equal(options.kiloExecutable?.startsWith(setup.freeze.candidateRuntimePath), true);
      } finally {
        setup.freeze?.dispose();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("failed certified setup removes generated receipt instructions", { skip: process.platform !== "darwin" }, () => {
  const root = mkdtempSync(join(tmpdir(), "certified-setup-cleanup-"));
  const repo = join(root, "repo");
  const output = join(root, "output");
  try {
    createMinimalBenchmarkRepository(repo);
    mkdirSync(output);
    bindCertifiedOutputRoot(output);
    const pi = createVersionExecutable(join(root, "pi-package"), "pi", "1.0.0");
    const kilo = createVersionExecutable(join(root, "kilo-package"), "kilo", "2.0.0");
    const options = parseRunnerArgs([
      "--certified",
      "--model",
      "surface/model",
      "--expected-resolved-model",
      "backend/model",
      "--runs",
      "3",
      "--pi-executable",
      pi,
      "--pi-version",
      "1.0.0",
      "--kilo-executable",
      kilo,
      "--kilo-version",
      "2.0.0",
      "--project-instructions-file",
      join(repo, "AGENTS.md"),
    ]);

    assert.throws(
      () => setupCertifiedBenchmark(options, { p: "0.4.0", pi: "wrong", kilo: "2.0.0" }, repo, output),
      /expected wrong/u,
    );
    assert.equal(existsSync(join(output, "instructions")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createVersionExecutable(root: string, name: string, version: string): string {
  const path = join(root, "bin", name);
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(path, `#!/bin/sh\necho '${version}'\n`);
  chmodSync(path, 0o755);
  return path;
}

function createMinimalBenchmarkRepository(repo: string): void {
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  mkdirSync(join(repo, "benchmarks", "src", "project-instructions"), { recursive: true });
  mkdirSync(join(repo, "benchmarks", "src", "harness"), { recursive: true });
  mkdirSync(join(repo, "benchmarks", "fixtures", "fixture"), { recursive: true });
  for (const pkg of ["ai", "tui", "agent", "code-index", "coding-agent", "site"]) {
    mkdirSync(join(repo, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(repo, "packages", pkg, "package.json"), JSON.stringify({ version: "0.4.0" }));
  }
  writeFileSync(join(repo, "packages", "coding-agent", "dist", "cli.js"), "process.exit(0);\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "0.4.0" }));
  writeFileSync(join(repo, "package-lock.json"), "{}\n");
  writeFileSync(join(repo, "AGENTS.md"), "# Rules\n");
  for (const file of [
    "run-agents.ts",
    "run-project-instructions.ts",
    "project-instructions/probe.ts",
    "project-instructions/seed.ts",
    "harness/seed-helper-process.ts",
  ]) {
    writeFileSync(join(repo, "benchmarks", "src", file), "export {};\n");
  }
  writeFileSync(join(repo, "benchmarks", "fixtures", "fixture", "visible.ts"), "export {};\n");
  writeFileSync(join(repo, "benchmarks", "fixtures", "fixture", "hidden.test.ts"), "// hidden\n");
  writeFileSync(join(repo, "benchmarks", "fixtures", "fixture", "rubric.json"), "[]\n");
}
