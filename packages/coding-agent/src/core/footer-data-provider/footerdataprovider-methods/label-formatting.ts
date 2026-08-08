import { readFileSync, unwatchFile } from "fs";
import { closeWatcher, FS_WATCH_RETRY_DELAY_MS } from "../../../utils/fs-watch.ts";
import { findIndexWorkspaceRoot } from "../../indexed-repos.ts";
import { FooterDataProvider } from "../footerdataprovider.ts";
import { findGitPaths, resolveBranchWithGitAsync, resolveBranchWithGitSync, sameIndexingStatus } from "../helpers.ts";

export function do_setAvailableProviderCount(self: FooterDataProvider, count: number): void {
  self.availableProviderCount = count;
}

export function do_setCwd(self: FooterDataProvider, cwd: string): void {
  if (self.cwd === cwd) {
    return;
  }

  self.cwd = cwd;
  if (self.refreshTimer) {
    clearTimeout(self.refreshTimer);
    self.refreshTimer = null;
  }
  self.clearGitWatchers();
  self.cachedBranch = undefined;
  self.gitPaths = findGitPaths(cwd);
  self.setupGitWatcher();
  self.refreshIndexingStatus();
  self.notifyBranchChange();
}

export function do_dispose(self: FooterDataProvider): void {
  self.disposed = true;
  clearInterval(self.indexingStatusTimer);
  if (self.refreshTimer) {
    clearTimeout(self.refreshTimer);
    self.refreshTimer = null;
  }
  self.clearGitWatchers();
  self.branchChangeCallbacks.clear();
  self.progressChangeCallbacks.clear();
}

export function do_notifyBranchChange(self: FooterDataProvider): void {
  for (const cb of self.branchChangeCallbacks) cb();
}

export function do_getIndexingRoot(self: FooterDataProvider): string {
  return findIndexWorkspaceRoot(self.cwd);
}

export function do_refreshIndexingStatus(self: FooterDataProvider): void {
  if (self.disposed) return;
  const nextStatus = self.indexingService.getStatus(self.getIndexingRoot());
  if (sameIndexingStatus(self.indexingStatus, nextStatus)) return;
  self.indexingStatus = nextStatus;
  self.notifyProgressChange();
}

export function do_scheduleRefresh(self: FooterDataProvider): void {
  if (self.disposed || self.refreshTimer) return;
  if (self.refreshInFlight) {
    self.refreshPending = true;
    return;
  }
  self.refreshTimer = setTimeout(() => {
    self.refreshTimer = null;
    void self.refreshGitBranchAsync();
  }, FooterDataProvider.WATCH_DEBOUNCE_MS);
}

export async function do_refreshGitBranchAsync(self: FooterDataProvider): Promise<void> {
  if (self.disposed) return;
  if (self.refreshInFlight) {
    self.refreshPending = true;
    return;
  }

  self.refreshInFlight = true;
  try {
    const nextBranch = await self.resolveGitBranchAsync();
    if (self.disposed) return;
    if (self.cachedBranch !== undefined && self.cachedBranch !== nextBranch) {
      self.cachedBranch = nextBranch;
      self.notifyBranchChange();
      return;
    }
    self.cachedBranch = nextBranch;
  } finally {
    self.refreshInFlight = false;
    if (self.refreshPending && !self.disposed) {
      self.refreshPending = false;
      self.scheduleRefresh();
    }
  }
}

export function do_resolveGitBranchSync(self: FooterDataProvider): string | null {
  try {
    if (!self.gitPaths) return null;
    const content = readFileSync(self.gitPaths.headPath, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) {
      const branch = content.slice(16);
      return branch === ".invalid" ? (resolveBranchWithGitSync(self.gitPaths.repoDir) ?? "detached") : branch;
    }
    return "detached";
  } catch {
    return null;
  }
}

export async function do_resolveGitBranchAsync(self: FooterDataProvider): Promise<string | null> {
  try {
    if (!self.gitPaths) return null;
    const content = readFileSync(self.gitPaths.headPath, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) {
      const branch = content.slice(16);
      return branch === ".invalid" ? ((await resolveBranchWithGitAsync(self.gitPaths.repoDir)) ?? "detached") : branch;
    }
    return "detached";
  } catch {
    return null;
  }
}

export function do_clearGitWatchers(self: FooterDataProvider): void {
  closeWatcher(self.headWatcher);
  self.headWatcher = null;
  if (self.headWatchFilePath && self.headWatchFileListener) {
    unwatchFile(self.headWatchFilePath, self.headWatchFileListener);
    self.headWatchFilePath = null;
    self.headWatchFileListener = null;
  }
  closeWatcher(self.reftableWatcher);
  self.reftableWatcher = null;
  closeWatcher(self.reftableTablesListWatcher);
  self.reftableTablesListWatcher = null;
  if (self.reftableTablesListPath) {
    unwatchFile(self.reftableTablesListPath);
    self.reftableTablesListPath = null;
  }
  if (self.gitWatcherRetryTimer) {
    clearTimeout(self.gitWatcherRetryTimer);
    self.gitWatcherRetryTimer = null;
  }
}

export function do_scheduleGitWatcherRetry(self: FooterDataProvider): void {
  if (self.disposed || self.gitWatcherRetryTimer) {
    return;
  }

  self.gitWatcherRetryTimer = setTimeout(() => {
    self.gitWatcherRetryTimer = null;
    self.setupGitWatcher();
  }, FS_WATCH_RETRY_DELAY_MS);
}

export function do_handleGitWatcherError(self: FooterDataProvider): void {
  self.clearGitWatchers();
  self.scheduleGitWatcherRetry();
}
