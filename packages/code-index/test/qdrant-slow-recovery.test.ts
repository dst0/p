import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

interface FakeChildProcess extends EventEmitter {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stderr: PassThrough;
  stdout: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    child.signalCode = signal;
    return true;
  });
  return child;
}

describe("Qdrant slow persisted-store recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("allows the default-managed process to become ready after more than 30 seconds", async () => {
    vi.useFakeTimers();
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-slow-recovery-"));
    const child = createFakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const readyAt = Date.now() + 45_000;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ status: Date.now() >= readyAt ? "ok" : "loading" }),
    );
    const manager = new QdrantServerManager(6333, { dataDirectory });

    try {
      const outcomePromise = manager.ensureStarted().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      let settled = false;
      void outcomePromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(30_500);
      expect(settled).toBe(false);
      expect(child.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(14_500);
      const outcome = await outcomePromise;

      expect(outcome).toEqual({ status: "fulfilled", value: true });
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      const stopped = manager.stop();
      child.exitCode = 0;
      child.signalCode = null;
      child.emit("exit", 0, null);
      await stopped;
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
