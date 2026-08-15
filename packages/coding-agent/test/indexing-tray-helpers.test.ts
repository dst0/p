import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGuiDesktopAvailable, isTrayEnabled, resolveTrayCommand } from "../src/core/indexing-tray-manager.ts";

describe("indexing tray helper functions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-tray-helpers-test-"));
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

    it("returns undefined when binary not found on darwin", () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      try {
        const plan = resolveTrayCommand(tempDir, "darwin");
        expect(plan).toBeUndefined();
      } finally {
        existsSpy.mockRestore();
      }
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

    it("returns undefined when script not found on linux", () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      try {
        const plan = resolveTrayCommand(tempDir, "linux");
        expect(plan).toBeUndefined();
      } finally {
        existsSpy.mockRestore();
      }
    });

    it("returns undefined for unsupported platforms", () => {
      expect(resolveTrayCommand(tempDir, "win32")).toBeUndefined();
      expect(resolveTrayCommand(tempDir, "freebsd" as NodeJS.Platform)).toBeUndefined();
    });
  });
});
