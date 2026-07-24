import type { Model } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import {
	collectEntriesForBranchSummary,
	generateBranchSummary,
	prepareBranchEntries,
} from "../src/harness/compaction/branch-summarization.ts";
import type { Session, SessionTreeEntry } from "../src/harness/types.ts";

vi.mock("@dst0/p-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dst0/p-ai")>();
	return {
		...actual,
		completeSimple: vi.fn(),
	};
});

import { completeSimple } from "@dst0/p-ai";

describe("branch-summarization", () => {
	const mockModel = {
		id: "test-model",
		api: "openai-completions",
		provider: "openai",
		name: "Test Model",
		contextWindow: 16000,
	} as Model<any>;

	it("collectEntriesForBranchSummary returns empty if oldLeafId is null", async () => {
		const session = {} as Session;
		const res = await collectEntriesForBranchSummary(session, null, "target-1");
		expect(res).toEqual({ entries: [], commonAncestorId: null });
	});

	it("collectEntriesForBranchSummary traverses up to common ancestor", async () => {
		const session: Partial<Session> = {
			getBranch: async (id: string) => {
				if (id === "leaf1")
					return [
						{ id: "root", parentId: null },
						{ id: "leaf1", parentId: "root" },
					] as any;
				if (id === "target1")
					return [
						{ id: "root", parentId: null },
						{ id: "target1", parentId: "root" },
					] as any;
				return [];
			},
			getEntry: async (id: string) => {
				if (id === "leaf1")
					return {
						id: "leaf1",
						parentId: "root",
						type: "message",
						message: { role: "user", content: "hi" },
					} as any;
				return null;
			},
		};

		const res = await collectEntriesForBranchSummary(session as Session, "leaf1", "target1");
		expect(res.commonAncestorId).toBe("root");
		expect(res.entries.length).toBe(1);
		expect(res.entries[0].id).toBe("leaf1");
	});

	it("prepareBranchEntries extracts file operations and messages", () => {
		const entries: SessionTreeEntry[] = [
			{
				id: "1",
				parentId: null,
				type: "branch_summary",
				summary: "prev summary",
				fromId: "0",
				timestamp: 100,
				details: { readFiles: ["/src/a.ts"], modifiedFiles: ["/src/b.ts"] },
			} as any,
			{
				id: "2",
				parentId: "1",
				type: "message",
				message: {
					role: "user",
					content: "Check file /src/c.ts",
					timestamp: 200,
				},
				timestamp: 200,
			} as any,
		];

		const prep = prepareBranchEntries(entries, 1000);
		expect(prep.messages.length).toBe(2);
		expect(prep.fileOps.read.has("/src/a.ts")).toBe(true);
		expect(prep.fileOps.edited.has("/src/b.ts")).toBe(true);
	});

	it("generateBranchSummary handles empty messages", async () => {
		const res = await generateBranchSummary([], {
			model: mockModel,
			apiKey: "key",
			signal: new AbortController().signal,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value.summary).toBe("No content to summarize");
		}
	});

	it("generateBranchSummary calls LLM and returns formatted summary", async () => {
		(completeSimple as any).mockResolvedValueOnce({
			stopReason: "stop",
			content: [{ type: "text", text: "## Goal\nTest branch" }],
		});

		const entries: SessionTreeEntry[] = [
			{
				id: "1",
				parentId: null,
				type: "message",
				message: { role: "user", content: "Explore /src/index.ts" },
				timestamp: 100,
			} as any,
		];

		const res = await generateBranchSummary(entries, {
			model: mockModel,
			apiKey: "key",
			signal: new AbortController().signal,
		});

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value.summary.includes("Summary of that exploration:")).toBe(true);
			expect(res.value.summary.includes("## Goal")).toBe(true);
		}
	});

	it("generateBranchSummary handles aborted or error response from LLM", async () => {
		(completeSimple as any).mockResolvedValueOnce({
			stopReason: "aborted",
			errorMessage: "Aborted request",
		});

		const entries: SessionTreeEntry[] = [
			{
				id: "1",
				parentId: null,
				type: "message",
				message: { role: "user", content: "Hello" },
				timestamp: 100,
			} as any,
		];

		const res = await generateBranchSummary(entries, {
			model: mockModel,
			apiKey: "key",
			signal: new AbortController().signal,
		});

		expect(res.ok).toBe(false);
	});
});
