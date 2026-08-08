import { existsSync, watchFile } from "fs";
import { dirname, join } from "path";
import { watchWithErrorHandler } from "../../../utils/fs-watch.ts";
import type { FooterDataProvider } from "../footerdataprovider.ts";
import { shouldPollGitHead } from "../helpers.ts";

export function do_setupGitWatcher(self: FooterDataProvider): void {
  self.clearGitWatchers();
  if (!self.gitPaths) return;

  const pollGitHead = shouldPollGitHead(self.gitPaths.repoDir);

  // Watch the directory containing HEAD, not HEAD itself.
  // Git uses atomic writes (write temp, rename over HEAD), which changes the inode.
  // fs.watch on a file stops working after the inode changes.
  self.headWatcher = watchWithErrorHandler(
    dirname(self.gitPaths.headPath),
    (_eventType, filename) => {
      if (!filename || filename === "HEAD") {
        self.scheduleRefresh();
      }
    },
    () => self.handleGitWatcherError(),
  );
  if (pollGitHead) {
    self.headWatchFilePath = self.gitPaths.headPath;
    self.headWatchFileListener = (current, previous) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.ctimeMs !== previous.ctimeMs ||
        current.size !== previous.size
      ) {
        self.scheduleRefresh();
      }
    };
    watchFile(self.headWatchFilePath, { interval: 1000 }, self.headWatchFileListener);
  }
  if (!self.headWatcher && !pollGitHead) {
    return;
  }

  // In reftable repos, branch switches update files in the reftable directory
  // instead of HEAD. Watch it separately so the footer picks up those changes.
  const reftableDir = join(self.gitPaths.commonGitDir, "reftable");
  if (existsSync(reftableDir)) {
    self.reftableWatcher = watchWithErrorHandler(
      reftableDir,
      () => {
        self.scheduleRefresh();
      },
      () => self.handleGitWatcherError(),
    );
    if (!self.reftableWatcher) {
      return;
    }

    const tablesListPath = join(reftableDir, "tables.list");
    if (existsSync(tablesListPath)) {
      self.reftableTablesListPath = tablesListPath;
      self.reftableTablesListWatcher = watchWithErrorHandler(
        tablesListPath,
        () => {
          self.scheduleRefresh();
        },
        () => self.handleGitWatcherError(),
      );
      if (!self.reftableTablesListWatcher) {
        return;
      }
      watchFile(tablesListPath, { interval: 250 }, (current, previous) => {
        if (
          current.mtimeMs !== previous.mtimeMs ||
          current.ctimeMs !== previous.ctimeMs ||
          current.size !== previous.size
        ) {
          self.scheduleRefresh();
        }
      });
    }
  }
}
