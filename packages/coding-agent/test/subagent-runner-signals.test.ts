import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock, spawnSync: spawnSyncMock }));

import type { AgentConfig } from "../examples/extensions/subagent/agents.ts";
import type { SingleResult, SubagentDetails } from "../examples/extensions/subagent/formatters.ts";
import { runSingleAgent, signalProcessTree } from "../examples/extensions/subagent/runner.ts";

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

const agent: AgentConfig = {
  name: "reviewer",
  description: "Review code",
  systemPrompt: "",
  source: "user",
  filePath: "/tmp/reviewer.md",
};

function makeDetails(results: SingleResult[]): SubagentDetails {
  return { mode: "single", agentScope: "user", projectAgentsDir: null, results };
}

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  child.pid = 123;
  child.killed = false;
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    child.killed = true;
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  });
  return child;
}

function run(signal?: AbortSignal): Promise<SingleResult> {
  return runSingleAgent(
    process.cwd(),
    [agent],
    agent.name,
    "Inspect",
    undefined,
    undefined,
    signal,
    undefined,
    makeDetails,
    "provider/model",
    "high",
    "unlimited",
  );
}

describe("subagent child signal lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
  });

  it("does not report a child terminated by a signal as successful", async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const resultPromise = run();
    child.emit("close", null, "SIGTERM");

    const result = await resultPromise;
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/SIGTERM/);
  });

  it("force-kills a child that ignores SIGTERM and clears the escalation timer", async () => {
    vi.useFakeTimers();
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const resultPromise = run(controller.signal);
    const rejection = expect(resultPromise).rejects.toThrow(/aborted/iu);

    controller.abort();
    await vi.advanceTimersByTimeAsync(5_001);
    try {
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    } finally {
      if (child.kill.mock.calls.length < 2) child.emit("close", null, "SIGTERM");
    }
    await rejection;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).toHaveBeenCalledTimes(2);
  });

  it("terminates the complete process tree on Windows", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    spawnSyncMock.mockReturnValue({ status: 0 });
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const resultPromise = run(controller.signal);

    controller.abort();
    child.emit("close", null, "SIGTERM");

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "123", "/t", "/f"],
      expect.objectContaining({ windowsHide: true }),
    );
    await expect(resultPromise).rejects.toThrow(/aborted/iu);
  });

  it("falls back to child.kill on Windows when taskkill fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    spawnSyncMock.mockReturnValue({ status: 1 });
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const resultPromise = run(controller.signal);
    const rejection = expect(resultPromise).rejects.toThrow(/process-tree termination could not be confirmed/iu);

    controller.abort();

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "123", "/t", "/f"],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("close", null, "SIGTERM");
    await vi.advanceTimersByTimeAsync(6_001);
    await rejection;
  });

  it("signalProcessTree returns true when taskkill succeeds on Windows without child.kill", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    spawnSyncMock.mockReturnValue({ status: 0 });
    const child = createChild();

    const signaled = signalProcessTree(child as unknown as Parameters<typeof signalProcessTree>[0], "SIGTERM");
    expect(signaled).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("signalProcessTree attempts child.kill but reports an unconfirmed Windows tree", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    spawnSyncMock.mockReturnValue({ status: 1 });
    const child = createChild();
    child.kill.mockReturnValue(true);

    const signaled = signalProcessTree(child as unknown as Parameters<typeof signalProcessTree>[0], "SIGTERM");
    expect(signaled).toBe(false);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.kill.mockClear();
    spawnSyncMock.mockReturnValue({ error: new Error("taskkill ENOENT") });
    const signaledFromError = signalProcessTree(child as unknown as Parameters<typeof signalProcessTree>[0], "SIGKILL");
    expect(signaledFromError).toBe(false);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("signalProcessTree preserves POSIX process-group kill and falls back to child.kill on ESRCH", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const child = createChild();

    const signaled = signalProcessTree(child as unknown as Parameters<typeof signalProcessTree>[0], "SIGTERM");
    expect(signaled).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();

    const esrchError = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    killSpy.mockImplementation(() => {
      throw esrchError;
    });
    const fallbackSignaled = signalProcessTree(child as unknown as Parameters<typeof signalProcessTree>[0], "SIGTERM");
    expect(fallbackSignaled).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });
    killSpy.mockImplementation(() => {
      throw epermError;
    });
    expect(() => signalProcessTree(child as unknown as Parameters<typeof signalProcessTree>[0], "SIGTERM")).toThrow(
      epermError,
    );
  });
});
