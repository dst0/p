import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SessionFileAppendError,
  type SessionFileDurabilityOperations,
} from "../../src/core/session-manager/session-file-durability.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 2,
  };
}

describe("session append persistence consistency", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `session-append-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects an unserializable entry before the deferred first flush", () => {
    const session = SessionManager.create(tempDir, tempDir);
    const beforeEntries = session.getEntries();

    expect(() => session.appendCustomEntry("invalid-before-assistant", 1n)).toThrow(/serializ/iu);
    expect(session.getEntries()).toEqual(beforeEntries);

    session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    expect(() => session.appendMessage(assistantMessage("world"))).not.toThrow();
    expect(SessionManager.open(session.getSessionFile()!, tempDir).getEntries()).toHaveLength(2);
  });

  it("rolls back an entry that definitely failed before publication", () => {
    const session = SessionManager.create(tempDir, tempDir);
    session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    const assistantId = session.appendMessage(assistantMessage("world"));
    const beforeEntries = session.getEntries();
    const beforeFile = readFileSync(session.getSessionFile()!, "utf8");

    expect(() => session.appendCustomEntry("invalid", 1n)).toThrow(/serializ/iu);
    expect(session.getEntries()).toEqual(beforeEntries);
    expect(session.getLeafId()).toBe(assistantId);
    expect(readFileSync(session.getSessionFile()!, "utf8")).toBe(beforeFile);

    const validId = session.appendCustomEntry("valid", { ok: true });
    expect(session.getEntry(validId)?.parentId).toBe(assistantId);
    expect(SessionManager.open(session.getSessionFile()!, tempDir).getEntry(validId)?.parentId).toBe(assistantId);
  });

  it("poisons an in-memory session after an append may have been partially published", () => {
    const session = SessionManager.create(tempDir, tempDir) as SessionManager & {
      durabilityOperations?: Partial<SessionFileDurabilityOperations>;
    };
    session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    session.appendMessage(assistantMessage("world"));
    session.durabilityOperations = { writeFileSync: () => fail("partial append") };

    expect(() => session.appendCustomEntry("uncertain", { value: 1 })).toThrow(SessionFileAppendError);
    expect(() => session.appendCustomEntry("must-not-follow", { value: 2 })).toThrow(/reopen|recover/iu);

    const recovered = SessionManager.open(session.getSessionFile()!, tempDir);
    expect(() => recovered.appendCustomEntry("after-recovery", { value: 3 })).not.toThrow();
  });
});

function fail(message: string): never {
  throw new Error(message);
}
