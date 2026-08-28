import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Qdrant startup health polling settlement", () => {
  it("does not reschedule a health poll after the child exits", async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), "p-qdrant-poll-settle-"));
    temporaryDirectories.push(directory);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    let finishHealth: ((response: Response) => void) | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishHealth = resolve;
          }),
      );
    const manager = new QdrantServerManager(6333, {
      qdrantBinary: "/test/qdrant",
      dataDirectory: directory,
      startupTimeoutMs: 5 * 60_000,
    });

    const startup = manager.ensureStarted();
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    child.emit("exit", 1, null);
    await expect(startup).rejects.toThrow("before readiness");
    finishHealth?.(new Response("Unavailable", { status: 503 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
