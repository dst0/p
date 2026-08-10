import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { getSessionsDir } from "../../../config.ts";
import { normalizePath, resolvePath } from "../../../utils/paths.ts";
import { CURRENT_SESSION_VERSION } from "../constants.ts";
import { getDefaultSessionDir, getDefaultSessionDirPath } from "../session-context.ts";
import { assertValidSessionId, createSessionId } from "../session-id.ts";
import { loadEntriesFromFile, sessionCwdMatches } from "../session-io.ts";
import { buildSessionInfosWithConcurrency, listSessionsFromDir } from "../session-listing.ts";
import { SessionManager } from "../sessionmanager.ts";
import type { NewSessionOptions, SessionHeader, SessionInfo, SessionListProgress } from "../types.ts";

export function do_forkFrom(
  sourcePath: string,
  targetCwd: string,
  sessionDir?: string,
  options?: NewSessionOptions,
): SessionManager {
  const resolvedSourcePath = resolvePath(sourcePath);
  const resolvedTargetCwd = resolvePath(targetCwd);
  const sourceEntries = loadEntriesFromFile(resolvedSourcePath);
  if (sourceEntries.length === 0) {
    throw new Error(`Cannot fork: source session file is empty or invalid: ${resolvedSourcePath}`);
  }

  const sourceHeader = sourceEntries.find((e) => e.type === "session") as SessionHeader | undefined;
  if (!sourceHeader) {
    throw new Error(`Cannot fork: source session has no header: ${resolvedSourcePath}`);
  }

  const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(resolvedTargetCwd);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create new session file with new ID but forked content
  if (options?.id !== undefined) {
    assertValidSessionId(options.id);
  }
  const newSessionId = options?.id ?? createSessionId();
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const newSessionFile = join(dir, `${fileTimestamp}_${newSessionId}.jsonl`);

  // Write new header pointing to source as parent, with updated cwd
  const newHeader: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: newSessionId,
    timestamp,
    cwd: resolvedTargetCwd,
    parentSession: resolvedSourcePath,
  };
  writeFileSync(newSessionFile, `${JSON.stringify(newHeader)}\n`, { flag: "wx" });

  // Copy all non-header entries from source
  for (const entry of sourceEntries) {
    if (entry.type !== "session") {
      appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
    }
  }

  return new SessionManager(resolvedTargetCwd, dir, newSessionFile, true);
}

export async function do_list(
  cwd: string,
  sessionDir?: string,
  onProgress?: SessionListProgress,
): Promise<SessionInfo[]> {
  const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
  const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
  const resolvedCwd = resolvePath(cwd);
  const sessions = (await listSessionsFromDir(dir, onProgress)).filter(
    (session) => !filterCwd || sessionCwdMatches(session.cwd, resolvedCwd),
  );
  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

export async function do_listAll(
  sessionDirOrOnProgress?: string | SessionListProgress,
  onProgress?: SessionListProgress,
): Promise<SessionInfo[]> {
  const customSessionDir =
    typeof sessionDirOrOnProgress === "string" ? normalizePath(sessionDirOrOnProgress) : undefined;
  const progress = typeof sessionDirOrOnProgress === "function" ? sessionDirOrOnProgress : onProgress;
  if (customSessionDir) {
    const sessions = await listSessionsFromDir(customSessionDir, progress);
    sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
    return sessions;
  }

  const sessionsDir = getSessionsDir();

  try {
    if (!existsSync(sessionsDir)) {
      return [];
    }
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(sessionsDir, e.name));

    // Count total files first for accurate progress
    let totalFiles = 0;
    const dirFiles: string[][] = [];
    for (const dir of dirs) {
      try {
        const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
        dirFiles.push(files.map((f) => join(dir, f)));
        totalFiles += files.length;
      } catch {
        dirFiles.push([]);
      }
    }

    // Process all files with progress tracking
    let loaded = 0;
    const sessions: SessionInfo[] = [];
    const allFiles = dirFiles.flat();

    const results = await buildSessionInfosWithConcurrency(allFiles, () => {
      loaded++;
      progress?.(loaded, totalFiles);
    });

    for (const info of results) {
      if (info) {
        sessions.push(info);
      }
    }

    sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
    return sessions;
  } catch {
    return [];
  }
}
