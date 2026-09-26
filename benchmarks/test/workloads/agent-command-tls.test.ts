import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { benchmarkSandboxExecutable } from "../../src/harness/benchmark-isolation.ts";
import { commandForAgent, sandboxedCommandIfNeeded } from "../../src/workloads/agent-command.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const configDir = "/tmp/p-benchmark-tls-config";
const workspace = "/tmp/p-benchmark-tls-workspace";
const task = { prompt: "fixture prompt", timeoutSeconds: 900 };

test("keeps TLS certificate verification enabled for PI and P provider requests", () => {
  const previousTlsOverride = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const options = parseRunnerArgs(["--agents", "pi,p", "--model", "provider/model"]);
    for (const agent of ["pi", "p"] as const) {
      const command = commandForAgent(agent, options, task, configDir, workspace);
      assert.equal(command.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined, agent);

      const repositoryCa = join(homedir(), ".p", "agent", "ca.pem");
      if (existsSync(repositoryCa)) {
        assert.equal(command.env.NODE_EXTRA_CA_CERTS, repositoryCa, agent);
      }
    }
  } finally {
    if (previousTlsOverride === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsOverride;
  }
});

test(
  "certified P and Pi can read only their extra CA file in the sandbox",
  { skip: !benchmarkSandboxExecutable() },
  () => {
    const root = mkdtempSync(join(tmpdir(), "benchmark-certified-ca-"));
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = root;
      assert.equal(homedir(), root);
      const caDir = join(root, ".p", "agent");
      const caPath = join(caDir, "ca.pem");
      const runtime = join(root, "runtime");
      const candidateWorkspace = join(root, "workspace");
      const candidateConfig = join(root, "config");
      for (const dir of [caDir, runtime, candidateWorkspace, candidateConfig]) mkdirSync(dir, { recursive: true });
      writeFileSync(caPath, "synthetic CA fixture\n");
      writeFileSync(join(caDir, "auth.json"), "unrelated fixture\n");
      const options = parseRunnerArgs([
        "--certified",
        "--model",
        "provider/model",
        "--expected-resolved-model",
        "provider/model",
        "--runs",
        "3",
      ]);
      options.candidateRuntimePath = runtime;

      for (const agent of ["p", "pi"] as const) {
        const command = commandForAgent(agent, options, task, candidateConfig, candidateWorkspace);
        assert.equal(command.env.NODE_EXTRA_CA_CERTS, caPath);
        const sandboxed = sandboxedCommandIfNeeded(command, options, candidateWorkspace, candidateConfig);
        const profile = sandboxed.args[1];
        assert.ok(profile.includes(`(allow file-read* (literal ${JSON.stringify(caPath)}))`), agent);
        assert.equal(profile.includes(`(allow file-read* (subpath ${JSON.stringify(caDir)}))`), false, agent);
        const read = (path: string) =>
          spawnSync(
            sandboxed.executable,
            [
              "-p",
              profile,
              process.execPath,
              "-e",
              'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))',
              path,
            ],
            {
              cwd: candidateWorkspace,
              encoding: "utf8",
              timeout: 15_000,
              env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
            },
          );
        const caRead = read(caPath);
        assert.equal(caRead.status, 0, `${agent}: ${caRead.stderr}`);
        assert.equal(caRead.stdout, "synthetic CA fixture\n");
        const siblingRead = read(join(caDir, "auth.json"));
        assert.notEqual(siblingRead.status, 0, `${agent}: sibling file must remain unreadable`);
        assert.equal(siblingRead.stdout, "");
      }
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  },
);
