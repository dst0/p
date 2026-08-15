import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexingDaemon } from "../src/core/indexing-daemon/indexingdaemon.ts";
import { do_reconcile } from "../src/core/indexing-daemon/indexingdaemon-methods/lifecycle.ts";
import { do_watchRegistry } from "../src/core/indexing-daemon/indexingdaemon-methods/status-monitoring.ts";
import type { IndexingTrayService } from "../src/core/indexing-tray-manager.ts";

/** Minimal stub satisfying the IndexingDaemon shape needed by do_reconcile/do_watchRegistry. */
function makeDaemonStub(
  agentDir: string,
  trayManager: IndexingTrayService,
  overrides: Record<string, unknown> = {},
): IndexingDaemon {
  return {
    disposed: false,
    quiescing: false,
    registryWatcher: null,
    runtimes: new Map(),
    options: { agentDir },
    trayManager,
    watchFactory: vi.fn(),
    syncRegistry: vi.fn().mockResolvedValue(undefined),
    writeStatus: vi.fn(),
    startDrain: vi.fn(),
    handleRegistryWatchError: vi.fn(),
    ...overrides,
  } as unknown as IndexingDaemon;
}

function makeTray() {
  const start = vi.fn(() => true);
  const stop = vi.fn(() => {});
  const isRunning = vi.fn(() => false);
  return {
    start,
    stop,
    isRunning,
  };
}

describe("indexing daemon tray integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-daemon-tray-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("do_reconcile tray management", () => {
    it("starts tray when enableTray is true (default)", async () => {
      const tray = makeTray();
      const daemon = makeDaemonStub(tempDir, tray);
      await do_reconcile(daemon);
      expect(tray.start).toHaveBeenCalledOnce();
      expect(tray.stop).not.toHaveBeenCalled();
    });

    it("stops tray when enableTray is false in code-rag.json", async () => {
      fs.writeFileSync(path.join(tempDir, "code-rag.json"), JSON.stringify({ enableTray: false }));
      const tray = makeTray();
      const daemon = makeDaemonStub(tempDir, tray);
      await do_reconcile(daemon);
      expect(tray.stop).toHaveBeenCalledOnce();
      expect(tray.start).not.toHaveBeenCalled();
    });

    it("stops tray when enableIndexingTray is false in settings.json", async () => {
      fs.writeFileSync(path.join(tempDir, "settings.json"), JSON.stringify({ enableIndexingTray: false }));
      const tray = makeTray();
      const daemon = makeDaemonStub(tempDir, tray);
      await do_reconcile(daemon);
      expect(tray.stop).toHaveBeenCalledOnce();
    });

    it("skips when daemon is disposed", async () => {
      const tray = makeTray();
      const daemon = makeDaemonStub(tempDir, tray, { disposed: true });
      await do_reconcile(daemon);
      expect(tray.start).not.toHaveBeenCalled();
      expect(tray.stop).not.toHaveBeenCalled();
    });
  });

  describe("do_watchRegistry tray toggle on config change", () => {
    it("starts tray on code-rag.json change when enabled", () => {
      const tray = makeTray();
      let watchCallback: ((event: string, filename: string | null) => void) | undefined;

      const mockWatcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      const daemon = makeDaemonStub(tempDir, tray, {
        watchFactory: (_dir: string, _opts: unknown, cb: (e: string, f: string | null) => void) => {
          watchCallback = cb;
          return mockWatcher;
        },
      });

      do_watchRegistry(daemon);
      expect(watchCallback).toBeDefined();

      // Simulate code-rag.json change with tray enabled (default)
      watchCallback!("change", "code-rag.json");
      expect(tray.start).toHaveBeenCalledOnce();
    });

    it("stops tray on settings.json change when disabled", () => {
      fs.writeFileSync(path.join(tempDir, "settings.json"), JSON.stringify({ enableIndexingTray: false }));
      const tray = makeTray();
      let watchCallback: ((event: string, filename: string | null) => void) | undefined;

      const mockWatcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      const daemon = makeDaemonStub(tempDir, tray, {
        watchFactory: (_dir: string, _opts: unknown, cb: (e: string, f: string | null) => void) => {
          watchCallback = cb;
          return mockWatcher;
        },
      });

      do_watchRegistry(daemon);
      watchCallback!("change", "settings.json");
      expect(tray.stop).toHaveBeenCalledOnce();
    });

    it("does not toggle tray on unrelated file changes", () => {
      const tray = makeTray();
      let watchCallback: ((event: string, filename: string | null) => void) | undefined;

      const mockWatcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      const daemon = makeDaemonStub(tempDir, tray, {
        watchFactory: (_dir: string, _opts: unknown, cb: (e: string, f: string | null) => void) => {
          watchCallback = cb;
          return mockWatcher;
        },
      });

      do_watchRegistry(daemon);
      watchCallback!("change", "some-other-file.json");
      expect(tray.start).not.toHaveBeenCalled();
      expect(tray.stop).not.toHaveBeenCalled();
    });
  });
});
