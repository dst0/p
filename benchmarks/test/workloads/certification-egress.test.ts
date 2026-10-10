import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { benchmarkSandboxExecutable, createBenchmarkSandboxProfile } from "../../src/harness/benchmark-isolation.ts";
import { validateBenchmarkRuntimeInputs } from "../../src/workloads/benchmark-runtime-validation.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { hasIpv6Loopback } from "../harness/ipv6-loopback.ts";

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
    const ipv4Profile = createBenchmarkSandboxProfile({ workspace, runtime, networkHosts: ["127.0.0.1:443"] });
    assert.match(ipv4Profile, /network-outbound.*localhost:443/u);
    assert.throws(
      () => createBenchmarkSandboxProfile({ workspace, runtime, networkHosts: ["127.0.0.2:443"] }),
      /Invalid certified network host/u,
    );
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
      const allowed = connect([`127.0.0.1:${port}`]);
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.throws(() => connect([`gateway.example.test:${port}`]), /Invalid certified network host/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "certified sandbox resolves localhost for Node HTTP without broad network access",
  { skip: !benchmarkSandboxExecutable() },
  async (context) => {
    if (!(await hasIpv6Loopback())) return context.skip("IPv6 loopback is unavailable on this host");
    const allowedServer = createServer((socket) => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok", () => socket.destroy());
    });
    let forbiddenConnections = 0;
    const forbiddenServer = createServer((socket) => {
      forbiddenConnections += 1;
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok", () => socket.destroy());
    });
    const root = mkdtempSync(join(tmpdir(), "certified-localhost-resolution-"));
    try {
      const listen = async (server: ReturnType<typeof createServer>): Promise<number> => {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen({ host: "::1", port: 0, ipv6Only: true }, resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        return address.port;
      };
      const allowedPort = await listen(allowedServer);
      const forbiddenPort = await listen(forbiddenServer);
      const workspace = join(root, "workspace");
      const runtime = join(root, "runtime");
      mkdirSync(workspace);
      mkdirSync(runtime);
      const probe = join(workspace, "node-http-probe.js");
      writeFileSync(
        probe,
        [
          'import http from "node:http";',
          "http.get(process.argv[2], (reply) => {",
          "  reply.resume();",
          '  reply.on("end", () => process.stdout.write(String(reply.statusCode)));',
          '}).on("error", (error) => { console.error(error.message); process.exitCode = 1; });',
        ].join("\n"),
      );
      const sandbox = benchmarkSandboxExecutable();
      assert.ok(sandbox);
      const profile = createBenchmarkSandboxProfile({ workspace, runtime, networkHosts: [`localhost:${allowedPort}`] });
      const connect = async (port: number): Promise<{ code: number | null; stdout: string; stderr: string }> => {
        const child = spawn(sandbox, ["-p", profile, process.execPath, probe, `http://localhost:${port}/v1`], {
          cwd: workspace,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr += chunk;
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
        try {
          const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
          return { code, stdout, stderr };
        } finally {
          clearTimeout(timer);
        }
      };
      const allowed = await connect(allowedPort);
      assert.equal(allowed.code, 0, allowed.stderr);
      assert.equal(allowed.stdout, "200");
      const forbidden = await connect(forbiddenPort);
      assert.notEqual(forbidden.code, 0, "An undeclared loopback port must remain inaccessible");
      assert.equal(forbiddenConnections, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      await Promise.all(
        [allowedServer, forbiddenServer].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
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
