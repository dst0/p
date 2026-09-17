import { existsSync, statSync } from "fs";
import { join } from "path";
import { resolvePath } from "../../../utils/paths.ts";
import { CURRENT_SESSION_VERSION } from "../constants.ts";
import { getDefaultSessionDirPath } from "../session-context.ts";
import {
  appendJsonLineDurably,
  assertJsonLineSerializable,
  backupCorruptedSession,
  SessionFileAppendError,
  SessionFilePublicationError,
  writeJsonLinesAtomically,
} from "../session-file-durability.ts";
import { assertValidSessionId, createSessionId, migrateToCurrentVersion } from "../session-id.ts";
import { loadEntriesFromFileResult } from "../session-io.ts";
import type { SessionManager } from "../sessionmanager.ts";
import type { NewSessionOptions, SessionEntry, SessionHeader } from "../types.ts";

export function do_setSessionFile(self: SessionManager, sessionFile: string): void {
  self.sessionFile = resolvePath(sessionFile);
  if (existsSync(self.sessionFile)) {
    const stats = statSync(self.sessionFile);
    const loadResult = loadEntriesFromFileResult(self.sessionFile);
    self.fileEntries = loadResult.entries;

    // If file was empty or corrupted (no valid header), truncate and start fresh
    // to avoid appending messages without a session header (which breaks the session)
    if (self.fileEntries.length === 0) {
      if (stats.size > 0) backupCorruptedSession(self.sessionFile);
      const explicitPath = self.sessionFile;
      self.newSession();
      self.sessionFile = explicitPath;
      self._rewriteFile();
      self.flushed = true;
      self.persistenceError = undefined;
      return;
    }

    const header = self.fileEntries.find((e) => e.type === "session") as SessionHeader | undefined;
    self.sessionId = header?.id ?? createSessionId();

    const migrated = migrateToCurrentVersion(self.fileEntries);
    if (loadResult.malformedLineCount > 0) backupCorruptedSession(self.sessionFile);
    if (migrated || loadResult.tornTail || loadResult.malformedLineCount > 0) {
      self._rewriteFile();
    }

    self._buildIndex();
    self.flushed = true;
    self.persistenceError = undefined;
  } else {
    const explicitPath = self.sessionFile;
    self.newSession();
    self.sessionFile = explicitPath; // preserve explicit path from --session flag
  }
}

export function do_newSession(self: SessionManager, options?: NewSessionOptions): string | undefined {
  if (options?.id !== undefined) {
    assertValidSessionId(options.id);
  }
  self.sessionId = options?.id ?? createSessionId();
  const timestamp = new Date().toISOString();
  const header: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: self.sessionId,
    timestamp,
    cwd: self.cwd,
    parentSession: options?.parentSession,
  };
  self.fileEntries = [header];
  self.byId.clear();
  self.labelsById.clear();
  self.leafId = null;
  self.flushed = false;
  self.persistenceError = undefined;

  if (self.persist) {
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    self.sessionFile = join(self.getSessionDir(), `${fileTimestamp}_${self.sessionId}.jsonl`);
  }
  return self.sessionFile;
}

export function do__buildIndex(self: SessionManager): void {
  self.byId.clear();
  self.labelsById.clear();
  self.labelTimestampsById.clear();
  self.leafId = null;
  for (const entry of self.fileEntries) {
    if (entry.type === "session") continue;
    self.byId.set(entry.id, entry);
    self.leafId = entry.id;
    if (entry.type === "label") {
      if (entry.label) {
        self.labelsById.set(entry.targetId, entry.label);
        self.labelTimestampsById.set(entry.targetId, entry.timestamp);
      } else {
        self.labelsById.delete(entry.targetId);
        self.labelTimestampsById.delete(entry.targetId);
      }
    }
  }
}

export function do__rewriteFile(self: SessionManager): void {
  if (!self.persist || !self.sessionFile) return;
  writeJsonLinesAtomically(self.sessionFile, self.fileEntries, {}, self.durabilityOperations);
}

export function do_isPersisted(self: SessionManager): boolean {
  return self.persist;
}

export function do_getCwd(self: SessionManager): string {
  return self.cwd;
}

export function do_getSessionDir(self: SessionManager): string {
  return self.sessionDir;
}

export function do_usesDefaultSessionDir(self: SessionManager): boolean {
  return self.sessionDir === getDefaultSessionDirPath(self.cwd);
}

export function do_getSessionId(self: SessionManager): string {
  return self.sessionId;
}

export function do_getSessionFile(self: SessionManager): string | undefined {
  return self.sessionFile;
}

export function do__persist(self: SessionManager, entry: SessionEntry): void {
  if (!self.persist || !self.sessionFile) return;

  const hasAssistant = self.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
  if (!hasAssistant) {
    if (self.flushed) {
      appendJsonLineDurably(self.sessionFile, entry, self.durabilityOperations);
    } else {
      // Mark as not flushed so when assistant arrives, all entries get written
      self.flushed = false;
    }
    return;
  }

  if (!self.flushed) {
    try {
      writeJsonLinesAtomically(self.sessionFile, self.fileEntries, { exclusive: true }, self.durabilityOperations);
      self.flushed = true;
    } catch (error) {
      if (error instanceof SessionFilePublicationError) self.flushed = true;
      throw error;
    }
  } else {
    appendJsonLineDurably(self.sessionFile, entry, self.durabilityOperations);
  }
}

export function do__appendEntry(self: SessionManager, entry: SessionEntry): void {
  if (self.persistenceError) {
    throw new Error("Session persistence is uncertain; reopen or recover the session before appending.", {
      cause: self.persistenceError,
    });
  }
  if (self.persist) assertJsonLineSerializable(entry);
  const previousLeafId = self.leafId;
  self.fileEntries.push(entry);
  self.byId.set(entry.id, entry);
  self.leafId = entry.id;
  try {
    self._persist(entry);
  } catch (error) {
    if (error instanceof SessionFilePublicationError || error instanceof SessionFileAppendError) {
      self.persistenceError = error;
      self._buildIndex();
    } else {
      self.fileEntries.pop();
      self.byId.delete(entry.id);
      self.leafId = previousLeafId;
    }
    throw error;
  }
}
