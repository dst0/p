import fs from "node:fs";
import { isTrayEnabled } from "../../indexing-tray-manager.ts";
import { acquireDaemonLock, releaseDaemonLock, safeErrorMessage, shouldRefreshRuntime } from "../helpers.ts";
import type { IndexingDaemon } from "../indexingdaemon.ts";
import type { IndexingDaemonStopOptions } from "../types.ts";

export async function do_ensureBackends(self: IndexingDaemon, signal?: AbortSignal): Promise<void> {
  self.cancelEmbeddingIdleTimer();
  await self._ensureBackendsRaw(signal);
  self.resetEmbeddingIdleTimer();
}

export async function do_start(self: IndexingDaemon): Promise<void> {
  if (self.disposed) throw new Error("Indexing daemon has been disposed");
  fs.mkdirSync(self.options.agentDir, { recursive: true, mode: 0o700 });
  self.daemonLock = acquireDaemonLock(self.options.agentDir);
  try {
    if (self.collectQdrantGarbageOnStart) await self.startQdrantMaintenance();
    self.watchRegistry();
    await self.syncRegistry();
    self.reconcileTimer = setInterval(() => void self.reconcile(), self.options.reconcileMs);
    self.resetEmbeddingIdleTimer();
    self.trayManager.start();
    self.writeStatus();
  } catch (error) {
    try {
      await self.stop();
    } catch {
      // Preserve the startup failure after best-effort cleanup.
    }
    throw error;
  }
}

export async function do_prepareForRestart(self: IndexingDaemon): Promise<void> {
  if (self.disposed || self.quiescing) return;
  self.quiescing = true;
  self.pauseIntake();
  const registrySyncPromise = self.registrySyncPromise;
  if (registrySyncPromise) await Promise.allSettled([registrySyncPromise]);
  await self.stopDrain(false, false);
  self.writeStatus();
}

export async function do_stop(self: IndexingDaemon, options: IndexingDaemonStopOptions = {}): Promise<void> {
  if (self.disposed) return;
  self.disposed = true;
  self.quiescing = true;
  self.pauseIntake();
  if (self.embeddingIdleTimer) clearTimeout(self.embeddingIdleTimer);
  self.trayManager.stop();
  const registrySyncPromise = self.registrySyncPromise;
  try {
    if (registrySyncPromise) await Promise.allSettled([registrySyncPromise]);
    await self.stopDrain(!options.graceful, false);
    for (const runtime of self.runtimes.values()) self.closeRuntime(runtime);
    await Promise.allSettled([...self.runtimes.values()].map((runtime) => runtime.service.dispose()));
    await self.disposeBackends();
  } finally {
    self.runtimes.clear();
    try {
      self.writeStatus(false);
    } finally {
      if (self.daemonLock) releaseDaemonLock(self.daemonLock);
      self.daemonLock = undefined;
    }
  }
}

export async function do_reconcile(self: IndexingDaemon): Promise<void> {
  if (self.disposed || self.quiescing) return;
  if (isTrayEnabled(self.options.agentDir)) {
    self.trayManager.start();
  } else {
    self.trayManager.stop();
  }
  await self.syncRegistry();
  if (self.disposed || self.quiescing) return;
  for (const runtime of self.runtimes.values()) {
    if (runtime.active || runtime.dirty || runtime.debounceTimer || runtime.resourceBlocked) continue;
    try {
      const status = await runtime.service.initialize({ checkFreshness: true });
      self.applyRuntimeStatus(runtime, status);
      if (shouldRefreshRuntime(runtime, status)) self.requestRefresh(runtime, false);
    } catch (error) {
      runtime.state = "error";
      runtime.lastError = safeErrorMessage(error);
      runtime.updatedAt = new Date().toISOString();
      self.requestRefresh(runtime, false);
    }
  }
  self.writeStatus();
}

export function do_syncRegistry(self: IndexingDaemon): Promise<void> {
  if (self.registrySyncPromise) {
    self.registrySyncRequested = true;
    return self.registrySyncPromise;
  }
  self.registrySyncPromise = self.runRegistrySync().finally(() => {
    self.registrySyncPromise = undefined;
    if (self.registrySyncRequested && !self.disposed && !self.quiescing) {
      self.registrySyncRequested = false;
      void self.syncRegistry();
    }
  });
  return self.registrySyncPromise;
}
