import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { benchmarkSandboxExecutable, createBenchmarkSandboxProfile } from "../../src/harness/benchmark-isolation.ts";
import { validateBenchmarkRuntimeInputs } from "../../src/workloads/benchmark-runtime-validation.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test("certified sandbox restricts network egress to declared LLM endpoint ports", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-egress-"));
  try {
    const workspace = join(root, "workspace");
    const runtime = join(root, "runtime");
    mkdirSync(workspace);
    mkdirSync(runtime);
    const profile = createBenchmarkSandboxProfile({
      workspace,
      runtime,
      networkHosts: ["gateway.example.test:443"],
    });
    assert.equal(profile.includes("(allow network*)"), false);
    assert.match(profile, /network-outbound.*\*:443/u);
    assert.equal(profile.includes("gateway.example.test"), false);
    assert.equal(profile.includes("exfiltration.example.test"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified endpoint profile compiles in the host sandbox", { skip: !benchmarkSandboxExecutable() }, () => {
  const root = mkdtempSync(join(tmpdir(), "certified-egress-profile-"));
  try {
    const workspace = join(root, "workspace");
    const runtime = join(root, "runtime");
    mkdirSync(workspace);
    mkdirSync(runtime);
    const profile = createBenchmarkSandboxProfile({ workspace, runtime, networkHosts: ["gateway.example.test:443"] });
    const sandbox = benchmarkSandboxExecutable();
    assert.ok(sandbox);
    const result = spawnSync(sandbox, ["-p", profile, "/usr/bin/true"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("actual certified runs require an explicit network endpoint allowlist", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "surface/model",
    "--expected-resolved-model",
    "backend/model",
    "--runs",
    "3",
  ]);
  options.pCli = process.execPath;
  options.piExecutable = process.execPath;
  options.kiloExecutable = process.execPath;
  options.projectInstructionsFile = import.meta.filename;
  options.projectInstructionProbe = import.meta.filename;
  options.modelsFile = import.meta.filename;
  options.kiloConfig = import.meta.filename;
  assert.throws(() => validateBenchmarkRuntimeInputs(options), /certified network host/u);

  options.certifiedNetworkHosts = ["gateway.example.test:443"];
  assert.doesNotThrow(() => validateBenchmarkRuntimeInputs(options));

  for (const invalidHost of [
    "gateway.example.test",
    "gateway.example.test:65536",
    "https://gateway.example.test",
    "*.example.test:443",
  ]) {
    options.certifiedNetworkHosts = [invalidHost];
    assert.throws(() => validateBenchmarkRuntimeInputs(options), /Invalid certified network host/u);
  }
});
