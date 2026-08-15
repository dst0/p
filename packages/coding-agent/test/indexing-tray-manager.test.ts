import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IndexingTrayManager,
  isGuiDesktopAvailable,
  isTrayEnabled,
  resolveTrayCommand,
} from "../src/core/indexing-tray-manager.ts";

describe("indexing-tray-manager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-tray-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isGuiDesktopAvailable", () => {
    it("returns true on darwin and win32", () => {
      expect(isGuiDesktopAvailable("darwin")).toBe(true);
      expect(isGuiDesktopAvailable("win32")).toBe(true);
    });

    it("returns false on headless linux without display env", () => {
      const origDisplay = process.env.DISPLAY;
      const origWayland = process.env.WAYLAND_DISPLAY;
      const origDbus = process.env.DBUS_SESSION_BUS_ADDRESS;
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
      delete process.env.DBUS_SESSION_BUS_ADDRESS;

      try {
        expect(isGuiDesktopAvailable("linux")).toBe(false);
      } finally {
        if (origDisplay !== undefined) process.env.DISPLAY = origDisplay;
        if (origWayland !== undefined) process.env.WAYLAND_DISPLAY = origWayland;
        if (origDbus !== undefined) process.env.DBUS_SESSION_BUS_ADDRESS = origDbus;
      }
    });

    it("returns true on linux when DISPLAY or WAYLAND_DISPLAY is set", () => {
      const origDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ":0";
      try {
        expect(isGuiDesktopAvailable("linux")).toBe(true);
      } finally {
        if (origDisplay !== undefined) process.env.DISPLAY = origDisplay;
        else delete process.env.DISPLAY;
      }

      const origWayland = process.env.WAYLAND_DISPLAY;
      process.env.WAYLAND_DISPLAY = "wayland-0";
      try {
        expect(isGuiDesktopAvailable("linux")).toBe(true);
      } finally {
        if (origWayland !== undefined) process.env.WAYLAND_DISPLAY = origWayland;
        else delete process.env.WAYLAND_DISPLAY;
      }
    });

    it("returns false on unsupported platforms", () => {
      expect(isGuiDesktopAvailable("freebsd" as NodeJS.Platform)).toBe(false);
      expect(isGuiDesktopAvailable("aix" as NodeJS.Platform)).toBe(false);
    });
  });

  describe("isTrayEnabled", () => {
    it("defaults to true when no config exists", () => {
      expect(isTrayEnabled(tempDir)).toBe(true);
    });

    it("returns false when enableTray is false in code-rag.json", () => {
      fs.writeFileSync(path.join(tempDir, "code-rag.json"), JSON.stringify({ enableTray: false }));
      expect(isTrayEnabled(tempDir)).toBe(false);
    });

    it("returns true when enableTray is true in code-rag.json", () => {
      fs.writeFileSync(path.join(tempDir, "code-rag.json"), JSON.stringify({ enableTray: true }));
      expect(isTrayEnabled(tempDir)).toBe(true);
    });

    it("returns false when enableIndexingTray is false in settings.json", () => {
      fs.writeFileSync(path.join(tempDir, "settings.json"), JSON.stringify({ enableIndexingTray: false }));
      expect(isTrayEnabled(tempDir)).toBe(false);
    });

    it("handles malformed config files gracefully", () => {
      fs.writeFileSync(path.join(tempDir, "code-rag.json"), "{ invalid json ");
      expect(isTrayEnabled(tempDir)).toBe(true);
      fs.writeFileSync(path.join(tempDir, "settings.json"), "{ invalid json ");
      expect(isTrayEnabled(tempDir)).toBe(true);
    });
  });

  describe("resolveTrayCommand", () => {
    it("finds tray binary if present in indexing-service/bin on darwin", () => {
      const binDir = path.join(tempDir, "indexing-service", "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const binPath = path.join(binDir, "p-indexing-tray");
      fs.writeFileSync(binPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const plan = resolveTrayCommand(tempDir, "darwin");
      expect(plan).toBeDefined();
      expect(plan?.command).toBe(binPath);
    });

    it("resolves python script with venv on linux", () => {
      const serviceRoot = path.join(tempDir, "indexing-service");
      const venvBin = path.join(serviceRoot, "venv", "bin");
      fs.mkdirSync(venvBin, { recursive: true });
      const venvPy = path.join(venvBin, "python");
      const trayPy = path.join(serviceRoot, "indexing_tray.py");
      fs.writeFileSync(venvPy, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      fs.writeFileSync(trayPy, "#!/usr/bin/env python3\n", { mode: 0o755 });

      const plan = resolveTrayCommand(tempDir, "linux");
      expect(plan).toBeDefined();
      expect(plan?.command).toBe(venvPy);
      expect(plan?.args).toEqual([trayPy]);
    });

    it("returns undefined for unsupported platforms", () => {
      expect(resolveTrayCommand(tempDir, "win32")).toBeUndefined();
      expect(resolveTrayCommand(tempDir, "freebsd" as NodeJS.Platform)).toBeUndefined();
    });
  });

  describe("IndexingTrayManager", () => {
    it("spawns and manages mock child process with correct arguments", () => {
      const binDir = path.join(tempDir, "indexing-service", "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const binPath = path.join(binDir, "p-indexing-tray");
      fs.writeFileSync(binPath, "", { mode: 0o755 });

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
      const startedAgain = manager.start();
      expect(startedAgain).toBe(true);
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
      const binPath = path.join(binDir, "p-indexing-tray");
      fs.writeFileSync(binPath, "", { mode: 0o755 });

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
      const binPath = path.join(binDir, "p-indexing-tray");
      fs.writeFileSync(binPath, "", { mode: 0o755 });

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

      // Emit crash/exit
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

      const started = manager.start();
      expect(started).toBe(false);
      expect(spawned).toBe(false);
    });
  });
});
