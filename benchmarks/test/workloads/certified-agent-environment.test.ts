import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { commandForAgent, commandForKiloModelResolution } from "../../src/workloads/agent-command.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test("certified candidate commands receive required paths but no caller credentials", () => {
  const privateKeys = [
    "OPENAI_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "P_BENCHMARK_PRIVATE_TOKEN",
  ];
  const originals = new Map(privateKeys.map((key) => [key, process.env[key]]));
  const originalPath = process.env.PATH;
  for (const key of privateKeys) process.env[key] = `private-${key}`;
  process.env.PATH = `/tmp/unsafe-candidate-bin:${originalPath ?? ""}`;
  try {
    const options = parseRunnerArgs([
      "--certified",
      "--model",
      "provider/model",
      "--expected-resolved-model",
      "provider/model",
      "--kilo-model",
      "kilo/model",
      "--runs",
      "3",
    ]);
    const configDir = "/tmp/certified-agent-config";
    const workspace = "/tmp/certified-agent-workspace";
    const task = { prompt: "fixture prompt", timeoutSeconds: 60 };
    const commands = [
      commandForAgent("p", options, task, configDir, workspace),
      commandForAgent("pi", options, task, configDir, workspace),
      commandForAgent("kilo", options, task, configDir, workspace),
      commandForKiloModelResolution(options, configDir, workspace),
    ];
    for (const command of commands) {
      for (const key of privateKeys) assert.equal(command.env[key], undefined, `${command.executable}: ${key}`);
      assert.equal(command.env.HOME, configDir);
      assert.equal(command.env.GIT_CONFIG_NOSYSTEM, "1");
      assert.equal(command.env.GIT_TERMINAL_PROMPT, "0");
      assert.ok(command.env.PATH);
      assert.equal(command.env.PATH?.includes("/tmp/unsafe-candidate-bin"), false);
    }
    assert.equal(commands[0]?.env.P_CODING_AGENT_DIR, configDir);
    assert.equal(commands[0]?.env.P_BENCHMARK_PROJECT_INSTRUCTION_MODE, "compiled");
    assert.equal(commands[0]?.env.P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_PATH, join(workspace, "AGENTS.md"));
    assert.equal(commands[1]?.env.PI_CODING_AGENT_DIR, configDir);
    assert.equal(commands[2]?.env.XDG_CONFIG_HOME, join(configDir, "config"));
    assert.equal(commands[3]?.env.XDG_STATE_HOME, join(configDir, "state"));
    for (const agent of ["agy", "codex"] as const) {
      assert.throws(
        () =>
          commandForAgent(
            agent,
            { ...options, agyModel: "fixture", codexModel: "fixture" },
            task,
            configDir,
            workspace,
          ),
        /Certified mode does not permit/u,
      );
    }
  } finally {
    for (const [key, original] of originals) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});
