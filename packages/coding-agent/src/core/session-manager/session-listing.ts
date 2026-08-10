import { createReadStream, existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline";
import { MAX_CONCURRENT_SESSION_INFO_LOADS } from "./constants.ts";
import { parseSessionEntryLine } from "./session-context.ts";
import { extractTextContent, getMessageActivityTime, isMessageWithContent } from "./session-io.ts";
import type { SessionHeader, SessionInfo, SessionListProgress } from "./types.ts";

export async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
  try {
    const stats = await stat(filePath);
    let header: SessionHeader | null = null;
    let messageCount = 0;
    let firstMessage = "";
    const allMessages: string[] = [];
    let name: string | undefined;
    let lastActivityTime: number | undefined;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const entry = parseSessionEntryLine(line);
      if (!entry) continue;

      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }

      // Extract session name (use latest, including explicit clears)
      if (entry.type === "session_info") {
        name = entry.name?.trim() || undefined;
      }

      if (entry.type !== "message") continue;
      messageCount++;

      const activityTime = getMessageActivityTime(entry);
      if (typeof activityTime === "number") {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }

      const message = entry.message;
      if (!isMessageWithContent(message)) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;

      const textContent = extractTextContent(message);
      if (!textContent) continue;

      allMessages.push(textContent);
      if (!firstMessage && message.role === "user") {
        firstMessage = textContent;
      }
    }

    if (!header) return null;

    const cwd = typeof header.cwd === "string" ? header.cwd : "";
    const parentSessionPath = header.parentSession;
    const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
    const modified =
      typeof lastActivityTime === "number" && lastActivityTime > 0
        ? new Date(lastActivityTime)
        : !Number.isNaN(headerTime)
          ? new Date(headerTime)
          : stats.mtime;

    return {
      path: filePath,
      id: header.id,
      cwd,
      name,
      parentSessionPath,
      created: new Date(header.timestamp),
      modified,
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      allMessagesText: allMessages.join(" "),
    };
  } catch {
    return null;
  }
}

export async function buildSessionInfosWithConcurrency(
  files: string[],
  onLoaded: () => void,
): Promise<(SessionInfo | null)[]> {
  const results: (SessionInfo | null)[] = new Array(files.length).fill(null);
  const inFlight = new Set<Promise<void>>();
  let nextIndex = 0;

  const startNext = (): void => {
    const index = nextIndex++;
    const file = files[index];
    if (!file) return;

    let task: Promise<void>;
    task = buildSessionInfo(file)
      .then((info) => {
        results[index] = info;
      })
      .catch(() => {
        results[index] = null;
      })
      .finally(() => {
        inFlight.delete(task);
        onLoaded();
      });
    inFlight.add(task);
  };

  while (nextIndex < files.length || inFlight.size > 0) {
    while (nextIndex < files.length && inFlight.size < MAX_CONCURRENT_SESSION_INFO_LOADS) {
      startNext();
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  return results;
}

export async function listSessionsFromDir(
  dir: string,
  onProgress?: SessionListProgress,
  progressOffset = 0,
  progressTotal?: number,
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  if (!existsSync(dir)) {
    return sessions;
  }

  try {
    const dirEntries = await readdir(dir);
    const files = dirEntries.filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
    const total = progressTotal ?? files.length;

    let loaded = 0;
    const results = await buildSessionInfosWithConcurrency(files, () => {
      loaded++;
      onProgress?.(progressOffset + loaded, total);
    });
    for (const info of results) {
      if (info) {
        sessions.push(info);
      }
    }
  } catch {
    // Return empty list on error
  }

  return sessions;
}
