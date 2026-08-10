import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialStructuredSessionState,
  getLatestStructuredSessionState,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
} from "../src/core/compaction/index.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("concurrent session isolation", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores concurrent sessions from the same cwd only in their own JSONL files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-concurrent-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "p-concurrent-sessions-"));
    tempDirs.push(cwd, sessionDir);

    const first = SessionManager.create(cwd, sessionDir);
    const second = SessionManager.create(cwd, sessionDir);
    const firstState = createInitialStructuredSessionState(first.getSessionId());
    const secondState = createInitialStructuredSessionState(second.getSessionId());
    firstState.canonicalRequest.current = "FIRST_SESSION_ONLY";
    secondState.canonicalRequest.current = "SECOND_SESSION_ONLY";

    first.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, firstState);
    second.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, secondState);
    first._rewriteFile();
    second._rewriteFile();

    const firstFile = first.getSessionFile();
    const secondFile = second.getSessionFile();
    expect(firstFile).toBeDefined();
    expect(secondFile).toBeDefined();
    expect(firstFile).not.toBe(secondFile);

    const firstContents = readFileSync(firstFile!, "utf8");
    const secondContents = readFileSync(secondFile!, "utf8");
    expect(firstContents).toContain("FIRST_SESSION_ONLY");
    expect(firstContents).not.toContain("SECOND_SESSION_ONLY");
    expect(secondContents).toContain("SECOND_SESSION_ONLY");
    expect(secondContents).not.toContain("FIRST_SESSION_ONLY");
    expect(getLatestStructuredSessionState(first.getBranch())?.sessionId).toBe(first.getSessionId());
    expect(getLatestStructuredSessionState(second.getBranch())?.sessionId).toBe(second.getSessionId());
    expect(existsSync(join(cwd, ".pdev/state/session.current.json"))).toBe(false);
  });
});
