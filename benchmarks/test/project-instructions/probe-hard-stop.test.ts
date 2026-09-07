import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import projectInstructionBenchmarkProbe from "../../src/project-instructions/probe.ts";

const hash = (character: string): string => character.repeat(64);

function proofEnvironment() {
  return {
    P_BENCHMARK_PROJECT_INSTRUCTION_RECEIPT: hash("6"),
    P_BENCHMARK_PROJECT_INSTRUCTION_MODE: "compiled",
    P_BENCHMARK_PROJECT_INSTRUCTION_TASK_VERIFICATION_MODE: "evidence",
    P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_SHA256: hash("7"),
    P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_PATH: "/workspace/AGENTS.md",
  };
}

test("probe hard-stops before agent work when startup-proof delivery fails", async () => {
  const handlers: Array<
    (
      event: Parameters<Parameters<typeof projectInstructionBenchmarkProbe>[0]["on"]>[1] extends (
        event: infer Event,
      ) => Promise<void>
        ? Event
        : never,
    ) => Promise<void>
  > = [];
  const exits: number[] = [];
  const errors: string[] = [];
  let disconnects = 0;
  const runtime = {
    env: proofEnvironment(),
    connected: true,
    send(_message: unknown, callback: (error?: Error | null) => void) {
      callback(new Error("closed channel"));
    },
    disconnect() {
      disconnects += 1;
    },
    exit(code: number) {
      exits.push(code);
    },
    stderr: {
      write(message: string) {
        errors.push(message);
      },
    },
  };
  projectInstructionBenchmarkProbe(
    {
      on(event, handler) {
        assert.equal(event, "before_agent_start");
        handlers.push(handler);
      },
    },
    runtime as unknown as Parameters<typeof projectInstructionBenchmarkProbe>[1],
  );
  assert.equal(handlers.length, 1);
  await handlers[0]({ systemPrompt: "", systemPromptOptions: { contextFiles: [] } });
  assert.equal(disconnects, 1);
  assert.deepEqual(exits, [86]);
  assert.deepEqual(errors, ["[project-instruction-preflight] startup-proof IPC delivery failed\n"]);
});

test("caught hook errors cannot resume agent work after startup-proof delivery failure", () => {
  const probeUrl = new URL("../../src/project-instructions/probe.ts", import.meta.url).href;
  const source = `
    import register from ${JSON.stringify(probeUrl)};
    let handler;
    register({ on(_event, value) { handler = value; } });
    try { await handler({ systemPrompt: "", systemPromptOptions: { contextFiles: [] } }); } catch {}
    process.stdout.write("agent-started");
  `;
  const execution = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env: { ...process.env, ...proofEnvironment() },
  });
  assert.equal(execution.status, 86, execution.stderr);
  assert.equal(execution.stdout, "");
  assert.equal(execution.stderr, "[project-instruction-preflight] startup-proof IPC delivery failed\n");
});
