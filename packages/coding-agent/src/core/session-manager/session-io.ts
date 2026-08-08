import type { AgentMessage } from "@dst0/p-agent-core";
import type { Message, TextContent } from "@dst0/p-ai";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import { normalizePath, resolvePath } from "../../utils/paths.ts";
import { SESSION_READ_BUFFER_SIZE } from "./constants.ts";
import { parseSessionEntryLine } from "./session-context.ts";
import type { FileEntry, SessionHeader, SessionMessageEntry } from "./types.ts";

export function loadEntriesFromFile(filePath: string): FileEntry[] {
  const resolvedFilePath = normalizePath(filePath);
  if (!existsSync(resolvedFilePath)) return [];

  const entries: FileEntry[] = [];
  const fd = openSync(resolvedFilePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);
    let pending = "";

    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;

      pending += decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = pending.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        const entry = parseSessionEntryLine(pending.slice(lineStart, newlineIndex));
        if (entry) entries.push(entry);
        lineStart = newlineIndex + 1;
        newlineIndex = pending.indexOf("\n", lineStart);
      }
      pending = pending.slice(lineStart);
    }

    pending += decoder.end();
    const finalEntry = parseSessionEntryLine(pending);
    if (finalEntry) entries.push(finalEntry);
  } finally {
    closeSync(fd);
  }

  // Validate session header
  if (entries.length === 0) return entries;
  const header = entries[0];
  if (header.type !== "session" || typeof (header as { id?: unknown }).id !== "string") {
    return [];
  }

  return entries;
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  try {
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(512);
    const bytesRead = readSync(fd, buffer, 0, 512, 0);
    closeSync(fd);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
    if (!firstLine) return null;
    const header = JSON.parse(firstLine) as Record<string, unknown>;
    if (header.type !== "session" || typeof header.id !== "string") {
      return null;
    }
    return header as unknown as SessionHeader;
  } catch {
    return null;
  }
}

export function getSessionHeaderCwd(header: SessionHeader): string | undefined {
  const cwd = (header as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : undefined;
}

export function sessionCwdMatches(cwd: string | undefined, resolvedCwd: string): boolean {
  return cwd !== undefined && cwd !== "" && resolvePath(cwd) === resolvedCwd;
}

export function findMostRecentSession(sessionDir: string, cwd?: string): string | null {
  const resolvedSessionDir = normalizePath(sessionDir);
  const resolvedCwd = cwd ? resolvePath(cwd) : undefined;
  try {
    const files = readdirSync(resolvedSessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(resolvedSessionDir, f))
      .map((path) => ({ path, header: readSessionHeader(path) }))
      .filter(
        (file): file is { path: string; header: SessionHeader } =>
          file.header !== null && (!resolvedCwd || sessionCwdMatches(getSessionHeaderCwd(file.header), resolvedCwd)),
      )
      .map(({ path }) => ({ path, mtime: statSync(path).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return files[0]?.path || null;
  } catch {
    return null;
  }
}

export function isMessageWithContent(message: AgentMessage): message is Message {
  return typeof (message as Message).role === "string" && "content" in message;
}

export function extractTextContent(message: Message): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}

export function getMessageActivityTime(entry: SessionMessageEntry): number | undefined {
  const message = entry.message;
  if (!isMessageWithContent(message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;

  const msgTimestamp = (message as { timestamp?: number }).timestamp;
  if (typeof msgTimestamp === "number") {
    return msgTimestamp;
  }

  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? undefined : t;
}
