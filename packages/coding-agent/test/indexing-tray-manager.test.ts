import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexingTrayManager } from "../src/core/indexing-tray-manager.ts";

describe("IndexingTrayManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-tray-mgr-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("spawns and manages mock child process with correct arguments", () => {
    const binDir = path.join(tempDir, "indexing-service", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "p-indexing-tray"), "", { mode: 0o755 });

    let spawnCount = 0;
    let killed = false;
    let passedOpts: Record<string, unknown> | undefined;

    const mockChild = Object.assign(new EventEmitter(), {
      pid: process.pid,
      killed: false,
      exitCode: null as number | null,
      unref: () => {},
      kill: (sig?: string) => {
        killed = true;
        mockChild.killed = true;
        mockChild.exitCode = 0;
        mockChild.emit("exit", 0, sig);
        return true;
      },
    });

    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: (_cmd, _args, opts) => {
        spawnCount++;
        passedOpts = opts;
        return mockChild as never;
      },
    });

    const started = manager.start();
    expect(started).toBe(true);
    expect(spawnCount).toBe(1);
    expect(manager.isRunning()).toBe(true);
    expect(passedOpts?.detached).toBe(true);
    expect((passedOpts?.env as Record<string, string>)?.P_CODING_AGENT_DIR).toBe(tempDir);

    // Second start is idempotent
    expect(manager.start()).toBe(true);
    expect(spawnCount).toBe(1);

    manager.stop();
    expect(killed).toBe(true);
    expect(manager.isRunning()).toBe(false);

    // Stop when not running is a no-op
    manager.stop();
    expect(manager.isRunning()).toBe(false);
  });

  it("handles synchronous spawn failure gracefully", () => {
    const binDir = path.join(tempDir, "indexing-service", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "p-indexing-tray"), "", { mode: 0o755 });

    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => {
        throw new Error("ENOENT: spawn failure");
      },
    });

    expect(manager.start()).toBe(false);
    expect(manager.isRunning()).toBe(false);
  });

  it("handles child process unexpected exit", () => {
    const binDir = path.join(tempDir, "indexing-service", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "p-indexing-tray"), "", { mode: 0o755 });

    const mockChild = Object.assign(new EventEmitter(), {
      pid: process.pid,
      killed: false,
      exitCode: null as number | null,
      unref: () => {},
      kill: () => true,
    });

    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => mockChild as never,
    });

    expect(manager.start()).toBe(true);
    expect(manager.isRunning()).toBe(true);

    mockChild.exitCode = 1;
    mockChild.emit("exit", 1, null);
    expect(manager.isRunning()).toBe(false);
  });

  it("skips starting when tray is disabled in config", () => {
    fs.writeFileSync(path.join(tempDir, "code-rag.json"), JSON.stringify({ enableTray: false }));

    let spawned = false;
    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => {
        spawned = true;
        return {} as never;
      },
    });

    expect(manager.start()).toBe(false);
    expect(spawned).toBe(false);
  });

  it("returns false when no binary found for darwin (no binary file)", () => {
    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => {
        throw new Error("should not be reached");
      },
    });
    expect(manager.start()).toBe(false);
  });

  it("returns false when no python script found for linux (no script file)", () => {
    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "linux",
      spawnProcess: () => {
        throw new Error("should not be reached");
      },
    });
    const orig = process.env.DISPLAY;
    process.env.DISPLAY = ":0";
    try {
      expect(manager.start()).toBe(false);
    } finally {
      if (orig !== undefined) process.env.DISPLAY = orig;
      else delete process.env.DISPLAY;
    }
  });

  it("isRunning returns true on EPERM (process exists but no permission to signal)", () => {
    const binDir = path.join(tempDir, "indexing-service", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "p-indexing-tray"), "", { mode: 0o755 });

    const mockChild = Object.assign(new EventEmitter(), {
      pid: 1,
      killed: false,
      exitCode: null as number | null,
      unref: () => {},
      kill: () => true,
    });

    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => mockChild as never,
    });
    manager.start();
    expect(manager.isRunning()).toBe(true);
  });

  it("isRunning returns false and clears process on ESRCH (process no longer exists)", () => {
    const binDir = path.join(tempDir, "indexing-service", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "p-indexing-tray"), "", { mode: 0o755 });

    const mockChild = Object.assign(new EventEmitter(), {
      pid: 2147483647,
      killed: false,
      exitCode: null as number | null,
      unref: () => {},
      kill: () => true,
    });

    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => mockChild as never,
    });
    manager.start();
    expect(manager.isRunning()).toBe(false);
  });

  it("isRunning falls back to process reference check when pid is absent", () => {
    const binDir = path.join(tempDir, "indexing-service", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "p-indexing-tray"), "", { mode: 0o755 });

    const mockChild = Object.assign(new EventEmitter(), {
      pid: undefined as number | undefined,
      killed: false,
      exitCode: null as number | null,
      unref: () => {},
      kill: () => true,
    });

    const manager = new IndexingTrayManager({
      agentDir: tempDir,
      platform: "darwin",
      spawnProcess: () => mockChild as never,
    });
    manager.start();
    expect(manager.isRunning()).toBe(true);
  });
});
