import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { JsonlSessionRepo } from "../../src/harness/session/jsonl-repo.ts";
import { JsonlSessionStorage, loadJsonlSessionMetadata } from "../../src/harness/session/jsonl-storage.ts";
import { getOrThrow } from "../../src/harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";

describe("JsonlSessionStorage & JsonlSessionRepo unit tests", () => {
  it("rejects invalid session headers in loadJsonlSessionMetadata & open", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });

    // Empty file
    getOrThrow(await env.writeFile("empty.jsonl", ""));
    await expect(loadJsonlSessionMetadata(env, join(root, "empty.jsonl"))).rejects.toThrow("missing session header");

    // Invalid JSON
    getOrThrow(await env.writeFile("bad_json.jsonl", "{bad json\n"));
    await expect(loadJsonlSessionMetadata(env, join(root, "bad_json.jsonl"))).rejects.toThrow(
      "first line is not a valid session header",
    );

    // Unsupported version
    getOrThrow(
      await env.writeFile(
        "version2.jsonl",
        `${JSON.stringify({ type: "session", version: 2, id: "s1", timestamp: "2026", cwd: root })}\n`,
      ),
    );
    await expect(loadJsonlSessionMetadata(env, join(root, "version2.jsonl"))).rejects.toThrow(
      "unsupported session version",
    );

    // Missing fields
    getOrThrow(
      await env.writeFile(
        "no_id.jsonl",
        `${JSON.stringify({ type: "session", version: 3, timestamp: "2026", cwd: root })}\n`,
      ),
    );
    await expect(loadJsonlSessionMetadata(env, join(root, "no_id.jsonl"))).rejects.toThrow(
      "session header is missing id",
    );

    getOrThrow(
      await env.writeFile("no_ts.jsonl", `${JSON.stringify({ type: "session", version: 3, id: "s1", cwd: root })}\n`),
    );
    await expect(loadJsonlSessionMetadata(env, join(root, "no_ts.jsonl"))).rejects.toThrow(
      "session header is missing timestamp",
    );

    getOrThrow(
      await env.writeFile(
        "no_cwd.jsonl",
        `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026" })}\n`,
      ),
    );
    await expect(loadJsonlSessionMetadata(env, join(root, "no_cwd.jsonl"))).rejects.toThrow(
      "session header is missing cwd",
    );

    getOrThrow(
      await env.writeFile(
        "bad_parent.jsonl",
        `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026", cwd: root, parentSession: 123 })}\n`,
      ),
    );
    await expect(loadJsonlSessionMetadata(env, join(root, "bad_parent.jsonl"))).rejects.toThrow(
      "session header parentSession must be a string",
    );
  });

  it("rejects invalid session entry lines during open", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const headerLine = JSON.stringify({
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: root,
    });

    // Entry not valid JSON
    getOrThrow(await env.writeFile("bad_entry_json.jsonl", `${headerLine}\n{invalid entry json\n`));
    await expect(JsonlSessionStorage.open(env, join(root, "bad_entry_json.jsonl"))).rejects.toThrow(
      "is not valid JSON",
    );

    // Missing entry type
    getOrThrow(
      await env.writeFile("no_type.jsonl", `${headerLine}\n${JSON.stringify({ id: "e1", timestamp: "2026" })}\n`),
    );
    await expect(JsonlSessionStorage.open(env, join(root, "no_type.jsonl"))).rejects.toThrow("is missing entry type");

    // Missing entry id
    getOrThrow(
      await env.writeFile(
        "no_entry_id.jsonl",
        `${headerLine}\n${JSON.stringify({ type: "message", timestamp: "2026" })}\n`,
      ),
    );
    await expect(JsonlSessionStorage.open(env, join(root, "no_entry_id.jsonl"))).rejects.toThrow("is missing entry id");

    // Invalid parentId
    getOrThrow(
      await env.writeFile(
        "bad_parent_id.jsonl",
        `${headerLine}\n${JSON.stringify({ type: "message", id: "e1", parentId: 123, timestamp: "2026" })}\n`,
      ),
    );
    await expect(JsonlSessionStorage.open(env, join(root, "bad_parent_id.jsonl"))).rejects.toThrow(
      "has invalid parentId",
    );

    // Missing timestamp
    getOrThrow(
      await env.writeFile(
        "no_entry_ts.jsonl",
        `${headerLine}\n${JSON.stringify({ type: "message", id: "e1", parentId: null })}\n`,
      ),
    );
    await expect(JsonlSessionStorage.open(env, join(root, "no_entry_ts.jsonl"))).rejects.toThrow(
      "is missing timestamp",
    );

    // Invalid leaf targetId
    getOrThrow(
      await env.writeFile(
        "bad_leaf_target.jsonl",
        `${headerLine}\n${JSON.stringify({ type: "leaf", id: "e1", parentId: null, timestamp: "2026", targetId: 123 })}\n`,
      ),
    );
    await expect(JsonlSessionStorage.open(env, join(root, "bad_leaf_target.jsonl"))).rejects.toThrow(
      "has invalid targetId",
    );
  });

  it("handles storage leaf and parent errors", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const storage = await JsonlSessionStorage.create(env, join(root, "sess.jsonl"), { cwd: root, sessionId: "s1" });

    await expect(storage.setLeafId("nonexistent")).rejects.toThrow("Entry nonexistent not found");

    // Corrupt path to root with missing parent entry in chain
    const entry1 = {
      type: "message",
      id: "e1",
      parentId: "missing_parent",
      timestamp: "2026",
      message: { role: "user", content: "hi" },
    } as any;
    await storage.appendEntry(entry1);
    await expect(storage.getPathToRoot("e1")).rejects.toThrow("Entry missing_parent not found");
  });

  it("JsonlSessionRepo list ignores corrupt sessions and open throws for missing path", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") });

    const s1 = await repo.create({ cwd: root });
    const metadata1 = await s1.getMetadata();

    // Create a corrupt .jsonl file in the sessions directory
    const sessionDir = join(root, "sessions", `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
    getOrThrow(await env.writeFile(join(sessionDir, "corrupt.jsonl"), "corrupt data\n"));

    const list = await repo.list({ cwd: root });
    expect(list.some((m) => m.id === metadata1.id)).toBe(true);

    // open non-existent session metadata
    await expect(
      repo.open({ id: "missing", createdAt: "2026", cwd: root, path: join(root, "missing.jsonl") }),
    ).rejects.toThrow("Session not found");
  });

  it("handles repo.delete, repo.fork, and repo.list with missing sessions root", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") });

    // list with missing root returns empty
    const emptyList = await repo.list({ cwd: root });
    expect(emptyList).toEqual([]);

    // create and populate session
    const s1 = await repo.create({ cwd: root });
    const e1Id = await s1.appendMessage({ role: "user", content: "msg 1", timestamp: Date.now() });
    const e2Id = await s1.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "msg 2" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const m1 = await s1.getMetadata();

    // fork at user message before
    const forkedBefore = await repo.fork(m1, { cwd: root, entryId: e1Id, position: "before" });
    expect((await forkedBefore.buildContext()).messages).toHaveLength(0);

    // fork at assistant message at
    const forkedAt = await repo.fork(m1, { cwd: root, entryId: e2Id, position: "at" });
    expect((await forkedAt.buildContext()).messages).toHaveLength(2);

    // fork error: non-user message position "before"
    await expect(repo.fork(m1, { cwd: root, entryId: e2Id, position: "before" })).rejects.toThrow(
      "is not a user message",
    );

    // delete session
    await repo.delete(m1);
    const listAfterDelete = await repo.list({ cwd: root });
    expect(listAfterDelete.some((m) => m.id === m1.id)).toBe(false);
  });

  it("handles corrupt leafId in getLeafId and non-ENOENT error in getFileSystemResultOrThrow", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const storage = await JsonlSessionStorage.create(env, join(root, "sess.jsonl"), { cwd: root, sessionId: "s1" });

    // Force corrupt currentLeafId on private field to test line 221
    (storage as any).currentLeafId = "missing_leaf_id";
    await expect(storage.getLeafId()).rejects.toThrow("Entry missing_leaf_id not found");
  });
});
