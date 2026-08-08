import { join, resolve } from "path";
import { normalizePath, resolvePath } from "../../../utils/paths.ts";
import { CURRENT_SESSION_VERSION } from "../constants.ts";
import { getDefaultSessionDir, getDefaultSessionDirPath } from "../session-context.ts";
import { createSessionId, generateId } from "../session-id.ts";
import { findMostRecentSession, loadEntriesFromFile } from "../session-io.ts";
import { SessionManager } from "../sessionmanager.ts";
import type { LabelEntry, NewSessionOptions, SessionEntry, SessionHeader } from "../types.ts";

export function do_createBranchedSession(self: SessionManager, leafId: string): string | undefined {
  const previousSessionFile = self.sessionFile;
  const path = self.getBranch(leafId);
  if (path.length === 0) {
    throw new Error(`Entry ${leafId} not found`);
  }

  // Filter out LabelEntry from path - we'll recreate them from the resolved map.
  // Because labels are real tree entries, later entries can be children of labels;
  // removing labels requires re-chaining the retained path to avoid orphaned subtrees.
  const pathWithoutLabels: SessionEntry[] = [];
  let pathParentId: string | null = null;
  for (const entry of path) {
    if (entry.type === "label") continue;
    pathWithoutLabels.push({ ...entry, parentId: pathParentId });
    pathParentId = entry.id;
  }

  const newSessionId = createSessionId();
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const newSessionFile = join(self.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);

  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: newSessionId,
    timestamp,
    cwd: self.cwd,
    parentSession: self.persist ? previousSessionFile : undefined,
  };

  // Collect labels for entries in the path
  const pathEntryIds = new Set(pathWithoutLabels.map((e) => e.id));
  const labelsToWrite: Array<{ targetId: string; label: string; timestamp: string }> = [];
  for (const [targetId, label] of self.labelsById) {
    if (pathEntryIds.has(targetId)) {
      labelsToWrite.push({ targetId, label, timestamp: self.labelTimestampsById.get(targetId)! });
    }
  }

  if (self.persist) {
    // Build label entries
    const lastEntryId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
    let parentId = lastEntryId;
    const labelEntries: LabelEntry[] = [];
    for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
      const labelEntry: LabelEntry = {
        type: "label",
        id: generateId(new Set(pathEntryIds)),
        parentId,
        timestamp: labelTimestamp,
        targetId,
        label,
      };
      pathEntryIds.add(labelEntry.id);
      labelEntries.push(labelEntry);
      parentId = labelEntry.id;
    }

    self.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
    self.sessionId = newSessionId;
    self.sessionFile = newSessionFile;
    self._buildIndex();

    // Only write the file now if it contains an assistant message.
    // Otherwise defer to _persist(), which creates the file on the
    // first assistant response, matching the newSession() contract
    // and avoiding the duplicate-header bug when _persist()'s
    // no-assistant guard later resets flushed to false.
    const hasAssistant = self.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
    if (hasAssistant) {
      self._rewriteFile();
      self.flushed = true;
    } else {
      self.flushed = false;
    }

    return newSessionFile;
  }

  // In-memory mode: replace current session with the path + labels
  const labelEntries: LabelEntry[] = [];
  let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
  for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
    const labelEntry: LabelEntry = {
      type: "label",
      id: generateId(new Set([...pathEntryIds, ...labelEntries.map((e) => e.id)])),
      parentId,
      timestamp: labelTimestamp,
      targetId,
      label,
    };
    labelEntries.push(labelEntry);
    parentId = labelEntry.id;
  }
  self.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
  self.sessionId = newSessionId;
  self._buildIndex();
  return undefined;
}

export function do_create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager {
  const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
  return new SessionManager(cwd, dir, undefined, true, options);
}

export function do_open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager {
  const resolvedPath = resolvePath(path);
  // Extract cwd from session header if possible, otherwise use process.cwd()
  const entries = loadEntriesFromFile(resolvedPath);
  const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
  const cwd = cwdOverride ?? header?.cwd ?? process.cwd();
  // If no sessionDir provided, derive from file's parent directory
  const dir = sessionDir ? normalizePath(sessionDir) : resolve(resolvedPath, "..");
  return new SessionManager(cwd, dir, resolvedPath, true);
}

export function do_continueRecent(cwd: string, sessionDir?: string): SessionManager {
  const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
  const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
  const mostRecent = findMostRecentSession(dir, filterCwd ? cwd : undefined);
  if (mostRecent) {
    return new SessionManager(cwd, dir, mostRecent, true);
  }
  return new SessionManager(cwd, dir, undefined, true);
}

export function do_inMemory(cwd: string = process.cwd()): SessionManager {
  return new SessionManager(cwd, "", undefined, false);
}
