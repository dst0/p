import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { getSubagentStorageDir, persistSubagentDigest, readSubagentDigests } from "../src/core/subagents.ts";
import { findWorkspaceRoot } from "../src/core/workspace-root.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const tempDirs: string[] = [];
const harnesses: Harness[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (!harness) continue;
    const target = {
      sessionDir: harness.sessionManager.getSessionDir(),
      sessionId: harness.sessionManager.getSessionId(),
      isPersisted: harness.sessionManager.isPersisted(),
    };
    rmSync(getSubagentStorageDir(target), { recursive: true, force: true });
    harness.cleanup();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("session isolation coverage", () => {
  it("persists a subagent transcript and digest under its current session leaf", async () => {
    const harness = await createHarness({ completionMode: "implicit" });
    harnesses.push(harness);
    const parentEntryId = harness.sessionManager.appendCustomEntry("parent-entry");
    harness.setResponses([fauxAssistantMessage("Session-scoped finding.")]);

    const result = await harness.session._runSubagent({ profile: "explore", task: "inspect session scope" });
    const target = {
      sessionDir: harness.sessionManager.getSessionDir(),
      sessionId: harness.sessionManager.getSessionId(),
      isPersisted: harness.sessionManager.isPersisted(),
    };
    const digests = readSubagentDigests(target, {
      sessionId: target.sessionId,
      validEntryIds: [parentEntryId],
    });

    expect(result.summary).toContain("Session-scoped finding.");
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({
      id: result.id,
      sessionId: target.sessionId,
      parentEntryId,
    });
    expect(digests[0]?.transcriptPath).toContain(join("p-subagents", target.sessionId));
  });

  it("rejects invalid subagent storage targets, digests, and filters", () => {
    const target = { sessionDir: "", sessionId: "session-a", isPersisted: false };
    const digest = {
      profile: "explore" as const,
      query: "scope",
      summary: "summary",
      evidencePointers: [],
      sessionId: "session-b",
      parentEntryId: null,
    };

    expect(() => getSubagentStorageDir({ ...target, sessionId: " " })).toThrow("Invalid target or sessionId");
    expect(() => persistSubagentDigest(target, digest)).toThrow("Digest sessionId must match target sessionId");
    expect(() => persistSubagentDigest(target, { ...digest, sessionId: "session-a", parentEntryId: " " })).toThrow(
      "Digest parentEntryId must be null or string",
    );
    expect(() => readSubagentDigests(target, { sessionId: "session-b", validEntryIds: [] })).toThrow(
      "Invalid filter configuration",
    );
  });

  it("canonicalizes a symlinked nested cwd before finding the git root", () => {
    const container = createTempDir("p-workspace-canonical-");
    const root = join(container, "repo");
    const nested = join(root, "src", "nested");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const linkedRoot = join(container, "repo-link");
    symlinkSync(root, linkedRoot, "dir");

    expect(findWorkspaceRoot(join(linkedRoot, "src", "nested"))).toBe(realpathSync(root));
    expect(findWorkspaceRoot(join(container, "missing", "nested"))).toBe(resolve(container, "missing", "nested"));
  });
});
