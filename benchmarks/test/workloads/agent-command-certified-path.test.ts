import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import {
  commandForAgent,
  commandForKiloModelResolution,
  sandboxedCommandIfNeeded,
} from "../../src/workloads/agent-command.ts";
import { parseRunnerArgs, repoRoot } from "../../src/workloads/runner-options.ts";

const task = { prompt: "complete the fixture", timeoutSeconds: 60 };

test("certified agent commands resolve toolchain binaries from the frozen runtime, not the live repository", () => {
  const root = mkdtempSync(join(tmpdir(), "certified runtime with spaces-"));
  const runtime = join(root, "candidate runtime");
  const runtimeToolchain = join(runtime, "node_modules", ".bin");
  const liveToolchain = join(repoRoot, "node_modules", ".bin");
  const previousPath = process.env.PATH;
  try {
    mkdirSync(runtimeToolchain, { recursive: true });
    assert.equal(existsSync(liveToolchain), true);
    process.env.PATH = [liveToolchain, repoRoot, previousPath].filter(Boolean).join(delimiter);
    const certified = parseRunnerArgs([
      "--certified",
      "--model",
      "provider/model",
      "--expected-resolved-model",
      "resolved/model",
      "--runs",
      "3",
    ]);
    certified.candidateRuntimePath = runtime;

    for (const agent of ["p", "pi", "kilo"] as const) {
      const command = commandForAgent(agent, certified, task, join(root, "config"), join(root, "workspace"));
      const pathEntries = command.env.PATH?.split(delimiter) ?? [];
      assert.ok(pathEntries.includes(realpathSync(runtimeToolchain)), `${agent}: ${command.env.PATH}`);
      assert.equal(pathEntries.includes(liveToolchain), false, `${agent}: ${command.env.PATH}`);
      assert.equal(pathEntries.includes(repoRoot), false, `${agent}: ${command.env.PATH}`);
    }
    const modelResolution = commandForKiloModelResolution(certified, join(root, "config"), join(root, "workspace"));
    assert.ok(modelResolution.env.PATH?.split(delimiter).includes(realpathSync(runtimeToolchain)));
    assert.equal(modelResolution.env.PATH?.split(delimiter).includes(liveToolchain), false);

    const exploratory = { ...certified, certified: false, candidateRuntimePath: undefined };
    const command = commandForAgent("p", exploratory, task, join(root, "config"), join(root, "workspace"));
    assert.ok(command.env.PATH?.split(delimiter).includes(liveToolchain));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("certified command construction and sandboxing fail closed without a frozen runtime", () => {
  const certified = parseRunnerArgs([
    "--certified",
    "--model",
    "provider/model",
    "--expected-resolved-model",
    "resolved/model",
    "--runs",
    "3",
  ]);
  assert.throws(
    () => commandForAgent("p", certified, task, "/tmp/config", "/tmp/workspace"),
    /frozen candidate runtime/u,
  );
  assert.throws(
    () =>
      sandboxedCommandIfNeeded(
        { executable: process.execPath, args: [], env: {}, cwd: "/tmp/workspace" },
        certified,
        "/tmp/workspace",
        "/tmp/config",
      ),
    /frozen candidate runtime/u,
  );
});
