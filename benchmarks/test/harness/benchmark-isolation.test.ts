import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  benchmarkSandboxExecutable,
  createBenchmarkSandboxProfile,
  createSandboxedBenchmarkCommand,
} from "../../src/harness/benchmark-isolation.ts";

test(
  "sandbox profile limits a child to its workspace and candidate runtime",
  { skip: !benchmarkSandboxExecutable() },
  () => {
    const root = mkdtempSync(join(tmpdir(), "benchmark-isolation-proof-"));
    const workspace = join(root, "workspace");
    const runtime = join(root, "runtime");
    const forbidden = join(root, "forbidden");
    const auth = join(root, "auth");
    const priorResults = join(root, "prior-results");
    mkdirSync(workspace);
    mkdirSync(runtime);
    mkdirSync(forbidden);
    mkdirSync(auth);
    mkdirSync(priorResults);
    try {
      writeFileSync(join(workspace, "workspace.txt"), "workspace\n");
      writeFileSync(join(runtime, "runtime.txt"), "runtime\n");
      writeFileSync(join(forbidden, "oracle.txt"), "oracle\n");
      writeFileSync(join(auth, "auth.json"), "credential\n");
      writeFileSync(join(priorResults, "result.json"), "prior\n");
      const read = (path: string) => {
        const command = createSandboxedBenchmarkCommand({ workspace, runtime }, "/bin/cat", [path]);
        return spawnSync(command.executable, command.args, { cwd: workspace, encoding: "utf8" });
      };
      const workspaceResult = read(join(workspace, "workspace.txt"));
      const runtimeResult = read(join(runtime, "runtime.txt"));
      const forbiddenResult = read(join(forbidden, "oracle.txt"));
      const authResult = read(join(auth, "auth.json"));
      const priorResult = read(join(priorResults, "result.json"));
      assert.equal(
        workspaceResult.status,
        0,
        `${workspaceResult.error?.message ?? ""} signal=${workspaceResult.signal ?? ""} stderr=${workspaceResult.stderr ?? ""}`,
      );
      assert.equal(
        runtimeResult.status,
        0,
        `${runtimeResult.error?.message ?? ""} signal=${runtimeResult.signal ?? ""} stderr=${runtimeResult.stderr ?? ""}`,
      );
      assert.equal(workspaceResult.stdout, "workspace\n");
      assert.equal(runtimeResult.stdout, "runtime\n");
      assert.notEqual(forbiddenResult.status, 0);
      assert.notEqual(authResult.status, 0);
      assert.notEqual(priorResult.status, 0);
      const nodeProbe = join(workspace, "probe.js");
      writeFileSync(
        nodeProbe,
        'import fs from "node:fs"; process.stdout.write(fs.readFileSync(process.argv[2], "utf8"));\n',
      );
      const nodeCommand = createSandboxedBenchmarkCommand({ workspace, runtime }, process.execPath, [
        nodeProbe,
        join(runtime, "runtime.txt"),
      ]);
      const nodeResult = spawnSync(nodeCommand.executable, nodeCommand.args, {
        cwd: workspace,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
      });
      assert.equal(
        nodeResult.status,
        0,
        `${nodeResult.error?.message ?? ""} signal=${nodeResult.signal ?? ""} stderr=${nodeResult.stderr ?? ""}`,
      );
      assert.equal(nodeResult.stdout, "runtime\n");
      const nodeForbiddenCommand = createSandboxedBenchmarkCommand({ workspace, runtime }, process.execPath, [
        nodeProbe,
        join(forbidden, "oracle.txt"),
      ]);
      const nodeForbiddenResult = spawnSync(nodeForbiddenCommand.executable, nodeForbiddenCommand.args, {
        cwd: workspace,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
      });
      assert.notEqual(nodeForbiddenResult.status, 0);

      const nodeWriteProbe = join(workspace, "write-probe.js");
      writeFileSync(nodeWriteProbe, 'import fs from "node:fs"; fs.writeFileSync(process.argv[2], "payload");\n');
      const writeRuntimeCommand = createSandboxedBenchmarkCommand({ workspace, runtime }, process.execPath, [
        nodeWriteProbe,
        join(runtime, "forbidden-write.txt"),
      ]);
      const writeRuntimeResult = spawnSync(writeRuntimeCommand.executable, writeRuntimeCommand.args, {
        cwd: workspace,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
      });
      assert.notEqual(writeRuntimeResult.status, 0);

      const writeWorkspaceCommand = createSandboxedBenchmarkCommand({ workspace, runtime }, process.execPath, [
        nodeWriteProbe,
        join(workspace, "allowed-write.txt"),
      ]);
      const writeWorkspaceResult = spawnSync(writeWorkspaceCommand.executable, writeWorkspaceCommand.args, {
        cwd: workspace,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
      });
      assert.equal(writeWorkspaceResult.status, 0);
      assert.equal(createBenchmarkSandboxProfile({ workspace, runtime }).includes(forbidden), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
