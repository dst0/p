import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";

const metricEventTypes = new Set(["result"]);

function command(source: string) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

async function withRecording(
  run: (recording: ReturnType<typeof createBenchmarkRecording>) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-liveness-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    await run(recording);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
}

test("semantic progress lease renews while an agent keeps streaming supported events", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command(`
        let count = 0;
        const timer = setInterval(() => {
          process.stdout.write(JSON.stringify({ type: "result", count }) + "\\n");
          count += 1;
          if (count === 12) {
            clearInterval(timer);
            setTimeout(() => process.exit(0), 25);
          }
        }, 50);
      `),
      500,
      recording,
      metricEventTypes,
      { timeoutMode: "semantic_progress" },
    );
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.timeoutKind, undefined);
    assert.ok(result.elapsedMs >= 550);
  });
});

test("semantic progress lease still terminates a silent agent", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command("setInterval(() => {}, 1000);"),
      100,
      recording,
      metricEventTypes,
      { timeoutMode: "semantic_progress" },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "inactivity");
    assert.equal(result.signal, "SIGTERM");
  });
});

test("arbitrary stdout does not renew the semantic progress lease", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command('setInterval(() => process.stdout.write("noise\\n"), 20);'),
      150,
      recording,
      metricEventTypes,
      { timeoutMode: "semantic_progress" },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "inactivity");
    assert.equal(result.signal, "SIGTERM");
  });
});

test("unsupported JSON events do not renew the semantic progress lease", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command('setInterval(() => process.stdout.write(JSON.stringify({ type: "heartbeat" }) + "\\n"), 20);'),
      150,
      recording,
      metricEventTypes,
      { timeoutMode: "semantic_progress" },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "inactivity");
    assert.equal(result.signal, "SIGTERM");
  });
});

test("one supported event cannot keep a subsequently silent agent alive", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command('process.stdout.write(JSON.stringify({ type: "result" }) + "\\n"); setInterval(() => {}, 1000);'),
      150,
      recording,
      metricEventTypes,
      { progressGraceMs: 100, timeoutMode: "semantic_progress" },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "inactivity");
    assert.equal(result.signal, "SIGTERM");
  });
});

test("hard deadline terminates an agent despite continuous progress", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command('setInterval(() => process.stdout.write(JSON.stringify({ type: "result" }) + "\\n"), 20);'),
      1_000,
      recording,
      metricEventTypes,
      { hardTimeoutMs: 150, timeoutMode: "semantic_progress" },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "hard_deadline");
    assert.equal(result.signal, "SIGTERM");
    assert.ok(result.elapsedMs < 2_000);
  });
});

test("hard deadline wins when it equals the inactivity deadline", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command("setInterval(() => {}, 1000);"),
      150,
      recording,
      metricEventTypes,
      { hardTimeoutMs: 150, timeoutMode: "semantic_progress" },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "hard_deadline");
    assert.equal(result.signal, "SIGTERM");
  });
});

test("a marker termination cannot be relabeled while cleanup is pending", async () => {
  await withRecording(async (recording) => {
    const result = await runBenchmarkAgentTurn(
      command(`
        process.stdout.write(JSON.stringify({ type: "result", status: "STOP" }) + "\\n");
        setInterval(() => {}, 1000);
      `),
      500,
      recording,
      metricEventTypes,
      {
        stopOnMarker: "STOP",
        terminateProcessTree: async (child) => {
          await new Promise((resolve) => setTimeout(resolve, 750));
          child.kill("SIGTERM");
          return true;
        },
        timeoutMode: "semantic_progress",
      },
    );
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.timeoutKind, undefined);
  });
});
