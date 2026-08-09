import { INDEXED_REPOS_FILE, loadIndexedRepos } from "../../indexed-repos.ts";
import {
  canonicalizePath,
  isDirectory,
  isIgnoredWatchPath,
  isReusableReadyStatus,
  parseManualRequestPriority,
  parseRequestPriority,
  safeErrorMessage,
  shouldRefreshRuntime,
} from "../helpers.ts";
import type { IndexingDaemon } from "../indexingdaemon.ts";
import type { RepositoryRuntime } from "../types.ts";

export async function do_runRegistrySync(self: IndexingDaemon): Promise<void> {
  if (self.disposed || self.quiescing) return;
  const enabledEntries = loadIndexedRepos(self.options.agentDir)
    .filter((entry) => entry.decision === "enabled")
    .map((entry) => ({ ...entry, root: canonicalizePath(entry.path) }))
    .filter((entry) => isDirectory(entry.root));
  const enabledRoots = new Set(enabledEntries.map((entry) => entry.root));

  const retiredRuntimes: RepositoryRuntime[] = [];
  for (const [root, runtime] of self.runtimes) {
    if (enabledRoots.has(root)) continue;
    self.closeRuntime(runtime);
    self.runtimes.delete(root);
    retiredRuntimes.push(runtime);
  }
  if (retiredRuntimes.length > 0) {
    self.writeStatus();
    await self.stopDrain(true, true);
    await Promise.allSettled(retiredRuntimes.map((runtime) => runtime.service.dispose()));
  }
  if (self.disposed || self.quiescing) return;

  const hasNewRuntimes = enabledEntries.some((entry) => !self.runtimes.has(entry.root));
  if (hasNewRuntimes) await self.ensureBackends();

  for (const entry of enabledEntries) {
    const root = entry.root;
    const existing = self.runtimes.get(root);
    if (existing) {
      if (entry.priorityRequest && existing.registryPriorityRequestId !== entry.priorityRequest.id) {
        existing.registryPriorityRequestId = entry.priorityRequest.id;
        if (existing.active) {
          self.acknowledgePriorityRequest(existing, entry.priorityRequest.id);
        } else {
          self.requestRefresh(existing, false, parseManualRequestPriority(entry.priorityRequest.requestedAt), false);
          self.preemptFor(existing);
        }
      }
      if (existing.registryUpdatedAt !== entry.updatedAt) {
        existing.registryUpdatedAt = entry.updatedAt;
        self.requestRefresh(existing, false, parseRequestPriority(entry.updatedAt), false);
      }
      continue;
    }
    const runtime: RepositoryRuntime = {
      root,
      service: self.serviceFactory(root),
      watcher: null,
      dirty: false,
      active: false,
      queueOrder: 0,
      queuePriority: 0,
      activePriority: 0,
      registryUpdatedAt: entry.updatedAt,
      registryPriorityRequestId: entry.priorityRequest?.id,
      state: "queued",
      indexedFiles: 0,
      indexedChunks: 0,
      readyValidated: false,
      consecutiveResourceFailureCount: 0,
      updatedAt: new Date().toISOString(),
    };
    self.runtimes.set(root, runtime);
    self.watchRepository(runtime);

    try {
      const initializedStatus = await runtime.service.initialize({ checkFreshness: true });
      self.applyRuntimeStatus(runtime, initializedStatus);
      runtime.readyValidated = isReusableReadyStatus(initializedStatus);
      if (entry.priorityRequest || shouldRefreshRuntime(runtime, initializedStatus)) {
        self.requestRefresh(
          runtime,
          false,
          entry.priorityRequest
            ? parseManualRequestPriority(entry.priorityRequest.requestedAt)
            : parseRequestPriority(entry.updatedAt),
          false,
        );
        if (entry.priorityRequest) self.preemptFor(runtime);
      }
    } catch (error) {
      runtime.state = "error";
      runtime.lastError = safeErrorMessage(error);
      self.requestRefresh(runtime, false, parseRequestPriority(entry.updatedAt), false);
    }
  }
  self.writeStatus();
  self.startDrain();
}

export function do_watchRegistry(self: IndexingDaemon): void {
  if (self.disposed || self.quiescing || self.registryWatcher) return;
  try {
    const watcher = self.watchFactory(self.options.agentDir, { recursive: false }, (_eventType, filename) => {
      const name = filename === null ? undefined : String(filename);
      if (name && name !== INDEXED_REPOS_FILE) return;
      void self.syncRegistry();
    });
    watcher.on("error", () => self.handleRegistryWatchError());
    self.registryWatcher = watcher;
  } catch {
    self.handleRegistryWatchError();
  }
}

export function do_handleRegistryWatchError(self: IndexingDaemon): void {
  self.registryWatcher?.close();
  self.registryWatcher = null;
  if (self.disposed || self.quiescing || self.registryWatchRetryTimer) return;
  self.registryWatchRetryTimer = setTimeout(() => {
    self.registryWatchRetryTimer = undefined;
    self.watchRegistry();
  }, self.options.retryMs);
}

export function do_watchRepository(self: IndexingDaemon, runtime: RepositoryRuntime, useRecursive = true): void {
  if (self.disposed || self.quiescing || runtime.watcher) return;
  try {
    const watcher = self.watchFactory(runtime.root, { recursive: useRecursive }, (_eventType, filename) => {
      if (filename !== null && isIgnoredWatchPath(String(filename))) return;
      self.requestRefresh(runtime, true);
    });
    watcher.on("error", () => {
      if (useRecursive) {
        runtime.watcher?.close();
        runtime.watcher = null;
        self.watchRepository(runtime, false);
      } else {
        self.handleRepositoryWatchError(runtime);
      }
    });
    runtime.watcher = watcher;
  } catch {
    if (useRecursive) {
      self.watchRepository(runtime, false);
    } else {
      self.handleRepositoryWatchError(runtime);
    }
  }
}

export function do_handleRepositoryWatchError(self: IndexingDaemon, runtime: RepositoryRuntime): void {
  runtime.watcher?.close();
  runtime.watcher = null;
  if (self.disposed || self.quiescing || runtime.watchRetryTimer) return;
  runtime.watchRetryTimer = setTimeout(() => {
    runtime.watchRetryTimer = undefined;
    if (self.runtimes.get(runtime.root) === runtime) self.watchRepository(runtime);
  }, self.options.retryMs);
}
