export const DRAIN_MAX_CONCURRENCY = 1;

export const MANUAL_PRIORITY_OFFSET = 1_000_000_000_000_000;

export const DEFAULT_REPOSITORY_TIMEOUT_MS = 30 * 60_000;

export const DAEMON_LOCK_INITIALIZATION_GRACE_MS = 10_000;

export const EMBEDDING_IDLE_TIMEOUT_MS = Number(process.env.EMBEDDING_IDLE_TIMEOUT_MS) || 15 * 60_000;

export const RESOURCE_BACKOFF_INTERVALS_SECONDS = [
  60,
  5 * 60,
  15 * 60,
  30 * 60,
  60 * 60,
  2 * 60 * 60,
  4 * 60 * 60,
  8 * 60 * 60,
  24 * 60 * 60,
];

export const IGNORED_WATCH_PATH_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".p",
  ".svn",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "storage",
  "target",
]);
