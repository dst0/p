import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";

describe("server process manager lifecycle and force kill escalation", () => {
  it("logs already running when checkHealth returns true on initial check inside start", async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const manager = new EmbeddingServerManager(28743, "model", {
      onLog: (level, message) => logs.push({ level, message }),
    });

    vi.spyOn(manager as unknown as { checkHealth(): Promise<boolean> }, "checkHealth").mockResolvedValue(true);

    const started = await (manager as unknown as { start(): Promise<boolean> }).start();
    expect(started).toBe(false);
    expect(logs.some((l) => l.message.includes("already running"))).toBe(true);
  });

  it("escalates to SIGKILL during EmbeddingServerManager stop when child process does not exit", async () => {
    vi.useFakeTimers();
    try {
      const mockChild = new EventEmitter() as unknown as {
        exitCode: number | null;
        signalCode: string | null;
        kill: ReturnType<typeof vi.fn>;
        emit: (event: string, ...args: unknown[]) => boolean;
      };
      mockChild.exitCode = null;
      mockChild.signalCode = null;
      mockChild.kill = vi.fn();

      const manager = new EmbeddingServerManager(28744);
      (manager as unknown as { child: typeof mockChild }).child = mockChild;

      const stopPromise = manager.stop();
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

      mockChild.emit("exit", 137, "SIGKILL");
      await stopPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates to SIGKILL during QdrantServerManager stop when child process does not exit", async () => {
    vi.useFakeTimers();
    try {
      const mockChild = new EventEmitter() as unknown as {
        exitCode: number | null;
        signalCode: string | null;
        kill: ReturnType<typeof vi.fn>;
        emit: (event: string, ...args: unknown[]) => boolean;
      };
      mockChild.exitCode = null;
      mockChild.signalCode = null;
      mockChild.kill = vi.fn();

      const manager = new QdrantServerManager(64334);
      (manager as unknown as { child: typeof mockChild }).child = mockChild;

      const stopPromise = manager.stop();
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

      mockChild.emit("exit", 137, "SIGKILL");
      await stopPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
