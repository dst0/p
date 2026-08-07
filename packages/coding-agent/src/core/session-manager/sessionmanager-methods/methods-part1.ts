import { appendFileSync, closeSync, existsSync, openSync, writeFileSync } from "fs";
import { join } from "path";
import { resolvePath } from "../../../utils/paths.ts";
import { CURRENT_SESSION_VERSION } from "../constants.ts";
import { assertValidSessionId, createSessionId, migrateToCurrentVersion } from "../helpers-part1.ts";
import { getDefaultSessionDirPath } from "../helpers-part2.ts";
import { loadEntriesFromFile } from "../helpers-part3.ts";
import type { SessionManager } from "../sessionmanager.ts";
import type { NewSessionOptions, SessionEntry, SessionHeader } from "../types-part1.ts";

export function do_setSessionFile(self: SessionManager, sessionFile: string): void {
  self.sessionFile = resolvePath(sessionFile);
  if (existsSync(self.sessionFile)) {
    self.fileEntries = loadEntriesFromFile(self.sessionFile);

    // If file was empty or corrupted (no valid header), truncate and start fresh
    // to avoid appending messages without a session header (which breaks the session)
    if (self.fileEntries.length === 0) {
      const explicitPath = self.sessionFile;
      self.newSession();
      self.sessionFile = explicitPath;
      self._rewriteFile();
      self.flushed = true;
      return;
    }

    const header = self.fileEntries.find((e) => e.type === "session") as SessionHeader | undefined;
    self.sessionId = header?.id ?? createSessionId();

    if (migrateToCurrentVersion(self.fileEntries)) {
      self._rewriteFile();
    }

    self._buildIndex();
    self.flushed = true;
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
  const fd = openSync(self.sessionFile, "w");
  try {
    for (const entry of self.fileEntries) {
      writeFileSync(fd, `${JSON.stringify(entry)}\n`);
    }
  } finally {
    closeSync(fd);
  }
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
      appendFileSync(self.sessionFile, `${JSON.stringify(entry)}\n`);
    } else {
      // Mark as not flushed so when assistant arrives, all entries get written
      self.flushed = false;
    }
    return;
  }

  if (!self.flushed) {
    const fd = openSync(self.sessionFile, "wx");
    try {
      for (const e of self.fileEntries) {
        writeFileSync(fd, `${JSON.stringify(e)}\n`);
      }
    } finally {
      closeSync(fd);
    }
    self.flushed = true;
  } else {
    appendFileSync(self.sessionFile, `${JSON.stringify(entry)}\n`);
  }
}

export function do__appendEntry(self: SessionManager, entry: SessionEntry): void {
  self.fileEntries.push(entry);
  self.byId.set(entry.id, entry);
  self.leafId = entry.id;
  self._persist(entry);
}
