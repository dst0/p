import { describe, expect, it } from "vitest";
import { InMemorySessionRepo } from "../../src/harness/session/memory-repo.ts";
import { InMemorySessionStorage } from "../../src/harness/session/memory-storage.ts";
import { createUserMessage } from "./session-test-utils.ts";

describe("InMemorySessionRepo unit tests", () => {
  it("creates, lists, opens, forks, and deletes sessions", async () => {
    const repo = new InMemorySessionRepo();
    const session1 = await repo.create({ id: "s1" });
    const u1 = await session1.appendMessage(createUserMessage("hello"));

    const metadataList = await repo.list();
    expect(metadataList).toHaveLength(1);
    expect(metadataList[0].id).toBe("s1");

    const opened = await repo.open(metadataList[0]);
    expect((await opened.buildContext()).messages).toHaveLength(1);

    const forked = await repo.fork(metadataList[0], { entryId: u1, id: "s2", position: "at" });
    expect((await forked.buildContext()).messages).toHaveLength(1);

    await repo.delete(metadataList[0]);
    const remaining = await repo.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("s2");

    await expect(repo.open(metadataList[0])).rejects.toThrow("Session not found: s1");
  });

  it("InMemorySessionStorage handles label deletion, invalid leaf initial state, and setLeafId error", async () => {
    const corruptEntries = [
      { type: "leaf", id: "l1", parentId: null, timestamp: "2026", targetId: "nonexistent" } as any,
    ];
    expect(() => new InMemorySessionStorage({ entries: corruptEntries })).toThrow("Entry nonexistent not found");

    const storage = new InMemorySessionStorage();
    await expect(storage.setLeafId("nonexistent")).rejects.toThrow("Entry nonexistent not found");

    const entry1 = {
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026",
      message: createUserMessage("hi"),
    } as any;
    const label1 = { type: "label", id: "l1", parentId: "e1", timestamp: "2026", targetId: "e1", label: "tag" } as any;
    const labelClear = {
      type: "label",
      id: "l2",
      parentId: "l1",
      timestamp: "2026",
      targetId: "e1",
      label: "   ",
    } as any;

    await storage.appendEntry(entry1);
    await storage.appendEntry(label1);
    expect(await storage.getLabel("e1")).toBe("tag");

    await storage.appendEntry(labelClear);
    expect(await storage.getLabel("e1")).toBeUndefined();
  });
});
