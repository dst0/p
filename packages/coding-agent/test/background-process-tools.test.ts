import { describe, expect, it } from "vitest";
import { BackgroundProcessManager } from "../src/core/tools/background-process.ts";
import { type BashOperations, createBashTool } from "../src/core/tools/bash.ts";
import { createProcessTool } from "../src/core/tools/process.ts";

interface ControlledProcess {
  operations: BashOperations;
  emit(data: string): void;
  complete(exitCode?: number): void;
}

function createControlledProcess(): ControlledProcess {
  let emitData: ((data: Buffer) => void) | undefined;
  let finish: ((result: { exitCode: number | null }) => void) | undefined;
  const operations: BashOperations = {
    exec: (_command, _cwd, { onData, signal }) =>
      new Promise((resolve) => {
        emitData = onData;
        finish = resolve;
        signal?.addEventListener("abort", () => resolve({ exitCode: null }), { once: true });
      }),
  };
  return {
    operations,
    emit(data) {
      if (!emitData) throw new Error("Process has not started");
      emitData(Buffer.from(data));
    },
    complete(exitCode = 0) {
      if (!finish) throw new Error("Process has not started");
      finish({ exitCode });
    },
  };
}

describe("background process tools", () => {
  it("yields a long-running bash command and wakes on output or completion", async () => {
    const manager = new BackgroundProcessManager();
    const controlled = createControlledProcess();
    const bash = createBashTool(process.cwd(), {
      operations: controlled.operations,
      processManager: manager,
    });
    const processTool = createProcessTool({ manager });

    const bashResult = await bash.execute("bash-1", { command: "long-running", yield_time_ms: 0 });
    const sessionId = bashResult.details?.sessionId;
    expect(sessionId).toBeDefined();
    expect(bashResult.details?.status).toBe("running");

    const outputWait = processTool.execute("process-1", { action: "wait", session_id: sessionId! });
    controlled.emit("first useful output\n");
    const outputResult = await outputWait;
    expect(outputResult.details.status).toBe("running");
    expect(outputResult.details.newOutput).toBe(true);
    expect(outputResult.progress).toBe("made_progress");
    expect(outputResult.details.output).toContain("first useful output");

    const completionWait = processTool.execute("process-2", { action: "wait", session_id: sessionId! });
    controlled.complete();
    const completionResult = await completionWait;
    expect(completionResult.details.status).toBe("completed");
    expect(completionResult.details.exitCode).toBe(0);
    expect(completionResult.progress).toBe("made_progress");
  });

  it("returns a wait-only result after a requested yield and can interrupt the process", async () => {
    const manager = new BackgroundProcessManager();
    const controlled = createControlledProcess();
    const bash = createBashTool(process.cwd(), {
      operations: controlled.operations,
      processManager: manager,
    });
    const processTool = createProcessTool({ manager });

    const bashResult = await bash.execute("bash-2", { command: "stuck", yield_time_ms: 0 });
    const sessionId = bashResult.details?.sessionId;
    expect(sessionId).toBeDefined();

    const yielded = await processTool.execute("process-3", {
      action: "wait",
      session_id: sessionId!,
      yield_time_ms: 1,
    });
    expect(yielded.details.status).toBe("running");
    expect(yielded.details.newOutput).toBe(false);
    expect(yielded.progress).toBe("waiting");

    const interrupted = await processTool.execute("process-4", { action: "kill", session_id: sessionId! });
    expect(interrupted.details.status).toBe("cancelled");
  });
});
