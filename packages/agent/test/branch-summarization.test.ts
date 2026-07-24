import type { Model } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import {
  collectEntriesForBranchSummary,
  generateBranchSummary,
  prepareBranchEntries,
} from "../src/harness/compaction/branch-summarization.ts";
import type { Session, SessionTreeEntry } from "../src/harness/types.ts";

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@dst0/p-ai")>();
  return {
    ...original,
    completeSimple: vi.fn(),
  };
});

describe("branch-summarization unit tests", () => {
  it("collectEntriesForBranchSummary collects chronological branch entries up to common ancestor", async () => {
    const entriesMap = new Map<string, SessionTreeEntry>([
      ["root", { id: "root", parentId: null, type: "session_info", name: "root" } as any],
      ["e1", { id: "e1", parentId: "root", type: "message", message: { role: "user", content: "hi" } } as any],
      [
        "e2_old",
        { id: "e2_old", parentId: "e1", type: "message", message: { role: "assistant", content: "old" } } as any,
      ],
      [
        "e2_target",
        { id: "e2_target", parentId: "e1", type: "message", message: { role: "user", content: "new" } } as any,
      ],
    ]);

    const mockSession: Partial<Session> = {
      async getBranch(id: string) {
        if (id === "e2_old") return [entriesMap.get("root")!, entriesMap.get("e1")!, entriesMap.get("e2_old")!];
        if (id === "e2_target") return [entriesMap.get("root")!, entriesMap.get("e1")!, entriesMap.get("e2_target")!];
        return [];
      },
      async getEntry(id: string) {
        return entriesMap.get(id);
      },
    };

    const resEmpty = await collectEntriesForBranchSummary(mockSession as Session, null, "e2_target");
    expect(resEmpty).toEqual({ entries: [], commonAncestorId: null });

    const res = await collectEntriesForBranchSummary(mockSession as Session, "e2_old", "e2_target");
    expect(res.commonAncestorId).toBe("e1");
    expect(res.entries.map((e) => e.id)).toEqual(["e2_old"]);
  });

  it("prepareBranchEntries aggregates messages, file ops, and respects token budgets", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "1",
        parentId: null,
        type: "branch_summary",
        summary: "Branch exploration",
        details: { readFiles: ["/tmp/file1.txt"], modifiedFiles: ["/tmp/file2.txt"] },
      } as any,
      {
        id: "2",
        parentId: "1",
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Read /tmp/file3.txt" }],
        },
      } as any,
    ];

    const prep = prepareBranchEntries(entries, 1000);
    expect(prep.messages.length).toBe(2);
    expect(Array.from(prep.fileOps.read)).toContain("/tmp/file1.txt");
    expect(Array.from(prep.fileOps.edited)).toContain("/tmp/file2.txt");
    expect(prep.totalTokens).toBeGreaterThan(0);
  });

  it("generateBranchSummary handles empty messages", async () => {
    const mockModel: Model<any> = {
      id: "mock-model",
      name: "Mock Model",
      api: "openai-completions" as any,
      provider: "openai" as any,
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const res = await generateBranchSummary([], {
      model: mockModel,
      apiKey: "fake-key",
      signal: new AbortController().signal,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.summary).toBe("No content to summarize");
    }
  });

  it("generateBranchSummary formats summary result from LLM response", async () => {
    const { completeSimple } = await import("@dst0/p-ai");
    vi.mocked(completeSimple).mockResolvedValueOnce({
      role: "assistant",
      content: [{ type: "text", text: "## Goal\nTest goal" }],
      api: "openai-completions" as any,
      provider: "openai" as any,
      model: "mock-model",
      stopReason: "stop",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    });

    const mockModel: Model<any> = {
      id: "mock-model",
      name: "Mock Model",
      api: "openai-completions" as any,
      provider: "openai" as any,
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };

    const entries: SessionTreeEntry[] = [
      {
        id: "e1",
        parentId: null,
        type: "message",
        message: { role: "user", content: "Explore new feature" },
      } as any,
    ];

    const res = await generateBranchSummary(entries, {
      model: mockModel,
      apiKey: "fake-key",
      signal: new AbortController().signal,
      customInstructions: "Focus on UI changes",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.summary).toContain("The user explored a different conversation branch");
      expect(res.value.summary).toContain("## Goal\nTest goal");
    }
  });
});
