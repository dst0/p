import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { commandForAgent, commandForKiloModelResolution } from "../../src/workloads/agent-command.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const configDir = "/tmp/p-benchmark-config";
const workspace = "/tmp/p-benchmark-workspace";
const task = { prompt: "fixture prompt", timeoutSeconds: 900 };

test("parses the established defaults for a PI/P comparison", () => {
  const options = parseRunnerArgs(["--model", "provider/model"]);
  assert.deepEqual(options.agents, ["pi", "p"]);
  assert.equal(options.model, "provider/model");
  assert.equal(options.runs, 1);
  assert.equal(options.timeoutSeconds, 300);
  assert.equal(options.maxRuntimeSeconds, 900);
  assert.equal(options.kiloStartupTimeoutSeconds, 60);
  assert.equal(options.thinking, undefined);
});

test("preserves sequential agent order and explicit numeric overrides", () => {
  const options = parseRunnerArgs([
    "--agents",
    "agy,kilo,codex,p",
    "--model",
    "provider/model",
    "--agy-model",
    "agy-model",
    "--kilo-model",
    "kilo/model",
    "--expected-resolved-model",
    "resolved/model",
    "--codex-model",
    "codex-model",
    "--runs",
    "3",
    "--minimum-timeout-seconds",
    "120",
  ]);
  assert.deepEqual(options.agents, ["agy", "kilo", "codex", "p"]);
  assert.equal(options.runs, 3);
  assert.equal(options.minimumTimeoutSeconds, 120);
});

test("rejects ambiguous or incomplete agent selections", () => {
  assert.throws(() => parseRunnerArgs(["--agents", "p"]), /--model is required/u);
  assert.throws(
    () => parseRunnerArgs(["--agents", "kilo", "--kilo-model", "kilo/model"]),
    /--expected-resolved-model is required/u,
  );
  assert.throws(
    () => parseRunnerArgs(["--agents", "p,p", "--model", "provider/model"]),
    /must not contain duplicates/u,
  );
  assert.throws(() => parseRunnerArgs(["--agents", "unknown"]), /Unsupported agent/u);
  assert.throws(() => parseRunnerArgs(["--runs", "0"]), /positive integer/u);
  assert.throws(() => parseRunnerArgs(["--unknown", "value"]), /Unknown option/u);
});

test("constructs the unchanged non-interactive P command", () => {
  const options = parseRunnerArgs(["--agents", "p", "--model", "provider/model"]);
  const command = commandForAgent("p", options, task, configDir, workspace);
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args.slice(1), [
    "--mode",
    "json",
    "--model",
    "provider/model",
    "--no-extensions",
    "--no-skills",
    "--no-themes",
    "--no-context-files",
    "fixture prompt",
  ]);
  assert.equal(command.env.P_CODING_AGENT_DIR, "/tmp/p-benchmark-config");
  assert.equal(command.env.PI_CODING_AGENT_DIR, "/tmp/p-benchmark-config");
  assert.equal(command.env.P_SKIP_VERSION_CHECK, "1");
  assert.equal(command.env.PI_SKIP_VERSION_CHECK, "1");
  assert.equal(command.env.NO_COLOR, "1");
});

test("passes an explicit thinking level to P but not PI", () => {
  const options = parseRunnerArgs(["--agents", "p", "--model", "provider/model", "--thinking", "off"]);
  const pCommand = commandForAgent("p", options, task, configDir, workspace);
  const thinkingIndex = pCommand.args.indexOf("--thinking");
  assert.deepEqual(pCommand.args.slice(thinkingIndex, thinkingIndex + 2), ["--thinking", "off"]);
  assert.equal(pCommand.args.at(-1), "fixture prompt");
  const piCommand = commandForAgent("pi", options, task, configDir, workspace);
  assert.equal(piCommand.args.includes("--thinking"), false);
  assert.throws(
    () => parseRunnerArgs(["--agents", "p", "--model", "provider/model", "--thinking", "invalid"]),
    /must be off, minimal, low, medium, high, or xhigh/u,
  );
});

test("passes the requested task-verification profile only to P", () => {
  const options = parseRunnerArgs(["--agents", "p", "--model", "provider/model", "--task-verification", "evidence"]);
  const pCommand = commandForAgent("p", options, task, configDir, workspace);
  const profileIndex = pCommand.args.indexOf("--task-verification");
  assert.deepEqual(pCommand.args.slice(profileIndex, profileIndex + 2), ["--task-verification", "evidence"]);
  assert.throws(
    () => parseRunnerArgs(["--agents", "p", "--model", "provider/model", "--task-verification", "invalid"]),
    /must be evidence, audit, or off/u,
  );
});

test("constructs exact commands for every supported agent", () => {
  const options = parseRunnerArgs([
    "--agents",
    "pi,p,kilo,codex,agy",
    "--model",
    "provider/model",
    "--kilo-model",
    "kilo/model",
    "--expected-resolved-model",
    "resolved/model",
    "--codex-model",
    "codex-model",
    "--agy-model",
    "agy-model",
  ]);
  const expected = {
    pi: {
      executable: "npm",
      args: [
        "exec",
        "--yes",
        "--package=@earendil-works/pi-coding-agent@0.82.1",
        "--",
        "pi",
        "--mode",
        "json",
        "--model",
        "provider/model",
        "--no-extensions",
        "--no-skills",
        "--no-themes",
        "--no-context-files",
        "fixture prompt",
      ],
    },
    p: {
      executable: process.execPath,
      args: [
        options.pCli,
        "--mode",
        "json",
        "--model",
        "provider/model",
        "--no-extensions",
        "--no-skills",
        "--no-themes",
        "--no-context-files",
        "fixture prompt",
      ],
    },
    kilo: {
      executable: "kilo",
      args: [
        "run",
        "--model",
        "kilo/model",
        "--format",
        "json",
        "--pure",
        "--auto",
        "--dir",
        workspace,
        "fixture prompt",
      ],
    },
    codex: {
      executable: "codex",
      args: [
        "exec",
        "-c",
        'model_provider="blackbox-ai-gateway"',
        "-m",
        "codex-model",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--color",
        "never",
        "-C",
        workspace,
        "fixture prompt",
      ],
    },
    agy: {
      executable: "agy",
      args: [
        "--model",
        "agy-model",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--print-timeout",
        "900s",
        "--new-project",
        "-p",
        "fixture prompt",
      ],
    },
  } as const;
  for (const agent of options.agents) {
    const command = commandForAgent(agent, options, task, configDir, workspace);
    assert.equal(command.executable, expected[agent].executable, agent);
    assert.deepEqual(command.args, expected[agent].args, agent);
    assert.equal(command.cwd, workspace, agent);
    assert.equal(command.env.NO_COLOR, "1", agent);
  }
  const kiloEnvironment = commandForAgent("kilo", options, task, configDir, workspace).env;
  assert.equal(kiloEnvironment.HOME, configDir);
  assert.equal(kiloEnvironment.XDG_CACHE_HOME, `${configDir}/cache`);
  assert.equal(kiloEnvironment.XDG_CONFIG_HOME, `${configDir}/config`);
  assert.equal(kiloEnvironment.XDG_DATA_HOME, `${configDir}/data`);
  assert.equal(kiloEnvironment.XDG_STATE_HOME, `${configDir}/state`);
  assert.equal(commandForAgent("codex", options, task, configDir, workspace).env.CODEX_HOME, configDir);
});

test("preserves continuation, probe, model-resolution, and project-instruction command branches", () => {
  const kiloOptions = parseRunnerArgs([
    "--agents",
    "kilo",
    "--kilo-model",
    "kilo/model",
    "--expected-resolved-model",
    "resolved/model",
  ]);
  const kiloContinue = commandForAgent("kilo", kiloOptions, task, configDir, workspace, true);
  assert.deepEqual(kiloContinue.args.slice(-4), ["--dir", workspace, "--continue", "fixture prompt"]);
  const kiloProbe = commandForAgent("kilo", kiloOptions, { ...task, isProbe: true }, configDir, workspace);
  assert.equal(kiloProbe.args.includes("--auto"), false);
  assert.deepEqual(commandForKiloModelResolution(kiloOptions, configDir, workspace).args, [
    "models",
    "kilo",
    "--verbose",
    "--pure",
  ]);

  const agyOptions = parseRunnerArgs(["--agents", "agy", "--agy-model", "agy-model"]);
  assert.equal(commandForAgent("agy", agyOptions, task, configDir, workspace, true).args.includes("--continue"), true);

  const receipt = "a".repeat(64);
  const projectOptions = parseRunnerArgs([
    "--agents",
    "p",
    "--model",
    "provider/model",
    "--project-instructions",
    "compiled",
    "--task-verification",
    "evidence",
    "--project-instruction-proof-receipt",
    receipt,
  ]);
  const projectCommand = commandForAgent("p", projectOptions, task, configDir, workspace, true);
  assert.equal(projectCommand.args.includes("--no-context-files"), false);
  assert.deepEqual(projectCommand.args.slice(-8), [
    "--task-verification",
    "evidence",
    "--continue",
    "--extension",
    projectOptions.projectInstructionProbe,
    "--project-instructions",
    "compiled",
    "fixture prompt",
  ]);
  assert.equal(projectCommand.env.P_BENCHMARK_PROJECT_INSTRUCTION_RECEIPT, receipt);
  assert.equal(projectCommand.env.P_BENCHMARK_PROJECT_INSTRUCTION_MODE, "compiled");
  assert.equal(projectCommand.env.P_BENCHMARK_PROJECT_INSTRUCTION_TASK_VERIFICATION_MODE, "evidence");
});

test("the TypeScript entrypoint exposes help and rejects incomplete CLI arguments", () => {
  const entrypoint = fileURLToPath(new URL("../../src/run-agents.ts", import.meta.url));
  const environment = { ...process.env };
  for (const name of ["PI_BENCHMARK_MODEL", "KILO_BENCHMARK_MODEL", "CODEX_BENCHMARK_MODEL", "AGY_BENCHMARK_MODEL"]) {
    delete environment[name];
  }
  const help = spawnSync(process.execPath, [entrypoint, "--help"], { encoding: "utf8", env: environment });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:\s+npm run benchmark:agents/u);

  const invalid = spawnSync(process.execPath, [entrypoint, "--agents", "p"], { encoding: "utf8", env: environment });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--model is required/u);
});
