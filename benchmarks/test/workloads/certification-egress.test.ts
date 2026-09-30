import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { benchmarkSandboxExecutable, createBenchmarkSandboxProfile } from "../../src/harness/benchmark-isolation.ts";
import { validateBenchmarkRuntimeInputs } from "../../src/workloads/benchmark-runtime-validation.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test("certified sandbox grants only the declared loopback endpoint", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-egress-"));
  try {
    const workspace = join(root, "workspace");
    const runtime = join(root, "runtime");
    mkdirSync(workspace);
    mkdirSync(runtime);
    const profile = createBenchmarkSandboxProfile({
      workspace,
      runtime,
      networkHosts: ["localhost:443"],
    });
    assert.equal(profile.includes("(allow network*)"), false);
    assert.match(profile, /network-outbound.*localhost:443/u);
    assert.equal(profile.includes('"*:443"'), false);
    assert.equal(profile.includes("exfiltration.example.test"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "certified sandbox rejects direct remote-host grants and permits its loopback endpoint",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    const root = mkdtempSync(join(tmpdir(), "certified-egress-host-"));
    try {
      const workspace = join(root, "workspace");
      const runtime = join(root, "runtime");
      mkdirSync(workspace);
      mkdirSync(runtime);
      const connect = (networkHosts: string[]) => {
        const profile = createBenchmarkSandboxProfile({ workspace, runtime, networkHosts });
        const sandbox = benchmarkSandboxExecutable();
        assert.ok(sandbox);
        return spawnSync(sandbox, ["-p", profile, "/usr/bin/nc", "-z", "-G", "2", "127.0.0.1", String(port)], {
          encoding: "utf8",
          timeout: 5_000,
        });
      };
      const allowed = connect([`localhost:${port}`]);
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.throws(() => connect([`gateway.example.test:${port}`]), /Invalid certified network host/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test("certified endpoint profile compiles in the host sandbox", { skip: !benchmarkSandboxExecutable() }, () => {
  const root = mkdtempSync(join(tmpdir(), "certified-egress-profile-"));
  try {
    const workspace = join(root, "workspace");
    const runtime = join(root, "runtime");
    mkdirSync(workspace);
    mkdirSync(runtime);
    const profile = createBenchmarkSandboxProfile({ workspace, runtime, networkHosts: ["localhost:443"] });
    const sandbox = benchmarkSandboxExecutable();
    assert.ok(sandbox);
    const result = spawnSync(sandbox, ["-p", profile, "/usr/bin/true"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("actual certified runs reserve the network endpoint for the parent-owned proxy", () => {
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
  assert.doesNotThrow(() => validateBenchmarkRuntimeInputs(options));

  options.certifiedNetworkHosts = ["localhost:443"];
  assert.throws(() => validateBenchmarkRuntimeInputs(options), /parent-owned proxy/u);

  for (const invalidHost of [
    "gateway.example.test",
    "gateway.example.test:443",
    "gateway.example.test:65536",
    "https://gateway.example.test",
    "*.example.test:443",
  ]) {
    options.certifiedNetworkHosts = [invalidHost];
    assert.throws(() => validateBenchmarkRuntimeInputs(options), /parent-owned proxy/u);
  }
});
