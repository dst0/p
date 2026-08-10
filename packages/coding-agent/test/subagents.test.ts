import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_SUBAGENT_PROFILES,
  createSubagentDigestContext,
  createSubagentProfilesPrompt,
  getSubagentAllowedTools,
  persistSubagentDigest,
  persistSubagentTranscript,
  readSubagentDigests,
} from "../src/core/subagents.ts";

const tempDirs: string[] = [];

function createTempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagents-"));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("subagent profiles and digests", () => {
  it("defines read-only built-in profiles and hides compact from parent prompt", () => {
    const prompt = createSubagentProfilesPrompt();

    expect(
      BUILTIN_SUBAGENT_PROFILES.filter((profile) => !profile.hidden).every(
        (profile) => profile.permissions.edit === "deny",
      ),
    ).toBe(true);
    expect(prompt).toContain("explore");
    expect(prompt).not.toContain("compact");
  });

  it("persists bounded digests for later recall instead of raw transcripts", () => {
    const cwd = createTempProject();
    const target = { sessionDir: cwd, sessionId: "sess-test", isPersisted: true };
    const digest = persistSubagentDigest(target, {
      profile: "explore",
      query: "rules resolver",
      summary: "Found AGENTS.md and .pdev/rules precedence.",
      evidencePointers: ["file:AGENTS.md"],
      sessionId: "sess-test",
      parentEntryId: "entry-root",
    });
    const context = createSubagentDigestContext(target, "rules precedence", {
      sessionId: "sess-test",
      validEntryIds: ["entry-root"],
    });

    expect(readSubagentDigests(target, { sessionId: "sess-test", validEntryIds: ["entry-root"] })).toEqual([digest]);
    expect(context).toContain(digest.id);
    expect(context).toContain("file:AGENTS.md");
  });

  it("maps read-only profile permissions to allowed tools", () => {
    const exploreTools = getSubagentAllowedTools("explore");

    expect(exploreTools.has("read")).toBe(true);
    expect(exploreTools.has("grep")).toBe(true);
    expect(exploreTools.has("edit")).toBe(false);
    expect(exploreTools.has("write")).toBe(false);
    expect(exploreTools.has("session_recall")).toBe(true);
  });

  it("stores raw subagent transcript separately from digest context", () => {
    const cwd = createTempProject();
    const target = { sessionDir: cwd, sessionId: "sess-test-transcript", isPersisted: true };
    const transcriptPath = persistSubagentTranscript(target, "subagent:explore:test", [
      {
        role: "user",
        content: [{ type: "text", text: "raw transcript detail" }],
        timestamp: Date.now(),
      },
    ]);
    const digest = persistSubagentDigest(target, {
      profile: "explore",
      query: "raw transcript",
      summary: "Digest only.",
      evidencePointers: [`file:${transcriptPath}`],
      transcriptPath,
      sessionId: "sess-test-transcript",
      parentEntryId: "entry-root",
    });
    const context = createSubagentDigestContext(target, "raw transcript", {
      sessionId: "sess-test-transcript",
      validEntryIds: ["entry-root"],
    });

    expect(existsSync(transcriptPath)).toBe(true);
    expect(readFileSync(transcriptPath, "utf8")).toContain("raw transcript detail");
    expect(readSubagentDigests(target, { sessionId: "sess-test-transcript", validEntryIds: ["entry-root"] })).toEqual([
      digest,
    ]);
    expect(context).toContain("Digest only.");
    expect(context).not.toContain("raw transcript detail");
  });

  it("enforces cross-session isolation for subagent digests and context", () => {
    const sessionDir = createTempProject();
    const sessionA = { sessionDir, sessionId: "sess-A", isPersisted: true };
    const sessionB = { sessionDir, sessionId: "sess-B", isPersisted: true };

    const digestA = persistSubagentDigest(sessionA, {
      profile: "explore",
      query: "auth flow",
      summary: "Session A auth findings",
      evidencePointers: [],
      sessionId: "sess-A",
      parentEntryId: "entry-1",
    });

    expect(readSubagentDigests(sessionA, { sessionId: "sess-A", validEntryIds: ["entry-1"] })).toEqual([digestA]);
    expect(readSubagentDigests(sessionB, { sessionId: "sess-B", validEntryIds: ["entry-1"] })).toEqual([]);

    const contextA = createSubagentDigestContext(sessionA, "auth flow", {
      sessionId: "sess-A",
      validEntryIds: ["entry-1"],
    });
    const contextB = createSubagentDigestContext(sessionB, "auth flow", {
      sessionId: "sess-B",
      validEntryIds: ["entry-1"],
    });

    expect(contextA).toContain("Session A auth findings");
    expect(contextB).toBeUndefined();
  });

  it("ignores and preserves legacy project-global subagent artifacts", () => {
    const cwd = createTempProject();
    const legacyDir = join(cwd, ".pdev/sessions");
    const legacyFile = join(legacyDir, "subagent-digests.jsonl");
    const target = { sessionDir: cwd, sessionId: "sess-current", isPersisted: true };
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(legacyFile, '{"summary":"LEGACY_SUBAGENT_SECRET"}\n', "utf8");

    expect(
      createSubagentDigestContext(target, "LEGACY_SUBAGENT_SECRET", {
        sessionId: "sess-current",
        validEntryIds: [],
      }),
    ).toBeUndefined();
    expect(readFileSync(legacyFile, "utf8")).toContain("LEGACY_SUBAGENT_SECRET");
  });

  it("enforces sibling-branch isolation for subagent digests and context", () => {
    const sessionDir = createTempProject();
    const target = { sessionDir, sessionId: "sess-123", isPersisted: true };

    const digestBranch1 = persistSubagentDigest(target, {
      profile: "review",
      query: "diff check",
      summary: "Branch 1 diff result",
      evidencePointers: [],
      sessionId: "sess-123",
      parentEntryId: "b1-entry",
    });

    const digestBranch2 = persistSubagentDigest(target, {
      profile: "review",
      query: "diff check",
      summary: "Branch 2 diff result",
      evidencePointers: [],
      sessionId: "sess-123",
      parentEntryId: "b2-entry",
    });

    // When on Branch 1 (entries: root-entry, b1-entry)
    const readOnBranch1 = readSubagentDigests(target, {
      sessionId: "sess-123",
      validEntryIds: new Set(["root-entry", "b1-entry"]),
    });
    expect(readOnBranch1).toEqual([digestBranch1]);

    // When on Branch 2 (entries: root-entry, b2-entry)
    const readOnBranch2 = readSubagentDigests(target, {
      sessionId: "sess-123",
      validEntryIds: new Set(["root-entry", "b2-entry"]),
    });
    expect(readOnBranch2).toEqual([digestBranch2]);

    const contextBranch1 = createSubagentDigestContext(target, "diff check", {
      sessionId: "sess-123",
      validEntryIds: new Set(["root-entry", "b1-entry"]),
    });
    expect(contextBranch1).toContain("Branch 1 diff result");
    expect(contextBranch1).not.toContain("Branch 2 diff result");
  });

  it("allows same-session retrieval when parentEntryId is null or in branch entry IDs", () => {
    const sessionDir = createTempProject();
    const target = { sessionDir, sessionId: "sess-same", isPersisted: true };

    const digestNull = persistSubagentDigest(target, {
      profile: "explore",
      query: "init query",
      summary: "Null parent digest",
      evidencePointers: [],
      sessionId: "sess-same",
      parentEntryId: null,
    });

    const digestAncestor = persistSubagentDigest(target, {
      profile: "scout",
      query: "init query",
      summary: "Ancestor entry digest",
      evidencePointers: [],
      sessionId: "sess-same",
      parentEntryId: "entry-root",
    });

    const read = readSubagentDigests(target, {
      sessionId: "sess-same",
      validEntryIds: new Set(["entry-root", "entry-leaf"]),
    });

    expect(read).toHaveLength(2);
    expect(read).toContainEqual(digestNull);
    expect(read).toContainEqual(digestAncestor);
  });
});
