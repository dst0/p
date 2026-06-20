import type { AgentMessage } from "@dst0/p-agent-core";
import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage, type Model } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRUCTURED_SESSION_STATE_CUSTOM_TYPE } from "../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "./harness.ts";

type SessionWithCompactionInternals = {
	checkCompaction: (
		assistantMessage: AssistantMessage,
		skipAbortedCheck?: boolean,
		additionalMessages?: AgentMessage[],
	) => Promise<boolean>;
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistant(
	harness: Harness,
	options: {
		stopReason?: AssistantMessage["stopReason"];
		errorMessage?: string;
		totalTokens?: number;
		timestamp?: number;
	},
): AssistantMessage {
	const model = harness.getModel();
	return {
		...fauxAssistantMessage("", {
			stopReason: options.stopReason,
			errorMessage: options.errorMessage,
			timestamp: options.timestamp,
		}),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(options.totalTokens ?? 0),
	};
}

function useSummaryStreamFn(harness: Harness, summary: string): () => number {
	let callCount = 0;
	harness.session.agent.streamFn = (model) => {
		callCount++;
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage(summary),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(10),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	return () => callCount;
}

function seedCompactableSession(harness: Harness): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact ".repeat(100) }],
		timestamp: now - 1000,
	});
	harness.sessionManager.appendMessage(
		createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 2000,
			timestamp: now - 500,
		}),
	);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

describe("AgentSession compaction characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("manually compacts using an extension-provided summary", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 10 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "summary from extension",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: { source: "extension" },
						},
					}));
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("one ".repeat(100));
		await harness.session.prompt("two ".repeat(100));

		const result = await harness.session.compact();
		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");

		expect(result.summary).toBe("summary from extension");
		expect(compactionEntries).toHaveLength(1);
		expect(
			harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === STRUCTURED_SESSION_STATE_CUSTOM_TYPE),
		).toHaveLength(0);
		expect(harness.session.messages[0]?.role).toBe("compactionSummary");
	});

	it("throws when compacting without a model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.agent.state.model = undefined as unknown as Model<any>;

		await expect(harness.session.compact()).rejects.toThrow("No model selected");
	});

	it("throws when compacting without configured auth", async () => {
		const harness = await createHarness({
			withConfiguredAuth: false,
			settings: { compaction: { keepRecentTokens: 10 } },
		});
		harnesses.push(harness);
		seedCompactableSession(harness);

		await expect(harness.session.compact()).rejects.toThrow(`No API key found for ${harness.getModel().provider}.`);
	});

	it("manually compacts with a custom streamFn when registry auth is absent", async () => {
		const harness = await createHarness({
			withConfiguredAuth: false,
			settings: { compaction: { keepRecentTokens: 10 } },
		});
		harnesses.push(harness);
		seedCompactableSession(harness);
		const getStreamCallCount = useSummaryStreamFn(harness, "summary from custom stream");

		const result = await harness.session.compact();
		const details = result.details as {
			audit?: {
				beforeTokens: number;
				afterTokens: number;
				savedTokens: number;
				summaryTokens: number;
				recentRawTokens: number;
				droppedEntries: string[];
			};
			markdownSummary?: string;
			structuredState?: unknown;
		};

		expect(result.summary).toContain("<session_checkpoint>");
		expect(details.audit).toMatchObject({
			beforeTokens: result.tokensBefore,
			summaryTokens: expect.any(Number),
			recentRawTokens: expect.any(Number),
			droppedEntries: expect.any(Array),
		});
		expect(details.audit?.afterTokens).toBeGreaterThan(0);
		expect(details.audit?.savedTokens).toBeGreaterThanOrEqual(0);
		expect(details.markdownSummary).toContain("summary from custom stream");
		expect(details.structuredState).toMatchObject({
			version: 1,
			canonicalRequest: { current: expect.any(String) },
		});
		const structuredEntries = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === STRUCTURED_SESSION_STATE_CUSTOM_TYPE);
		expect(structuredEntries).toHaveLength(1);
		expect(getStreamCallCount()).toBe(1);
	});

	it("auto-compacts with a custom streamFn when registry auth is absent", async () => {
		const harness = await createHarness({
			withConfiguredAuth: false,
			settings: { compaction: { keepRecentTokens: 10 } },
		});
		harnesses.push(harness);
		seedCompactableSession(harness);
		const getStreamCallCount = useSummaryStreamFn(harness, "auto summary from custom stream");
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		await sessionInternals._runAutoCompaction("threshold", false);

		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(1);
		expect(compactionEntries[0].type === "compaction" && (compactionEntries[0] as any).summary).toContain(
			"<session_checkpoint>",
		);
		expect(
			compactionEntries[0].type === "compaction" && (compactionEntries[0] as any).details?.markdownSummary,
		).toContain("auto summary from custom stream");
		expect(getStreamCallCount()).toBe(1);
	});

	it("retrieves old tool output by session_recall pointer", async () => {
		const harness = await createHarness({ initialActiveToolNames: ["session_recall"] });
		harnesses.push(harness);
		harness.sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "call-old",
			toolName: "bash",
			content: [{ type: "text", text: "secret old failure line\nsecond line" }],
			isError: true,
			timestamp: Date.now(),
		});

		const recallTool = harness.session.agent.state.tools.find((tool) => tool.name === "session_recall");
		expect(recallTool).toBeDefined();
		const result = await recallTool!.execute("recall-1", {
			query: "tool-result:call-old",
			includeRaw: true,
			maxTokens: 50,
		});
		const text = result.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n");

		expect(text).toContain("tool-result:call-old");
		expect(text).toContain("Coverage: complete");
		expect(text).toContain("do not call session_recall again for this same pointer");
		expect(text).toContain("secret old failure line");
	});

	it("returns a larger default excerpt for raw session_recall", async () => {
		const harness = await createHarness({ initialActiveToolNames: ["session_recall"] });
		harnesses.push(harness);
		const longOutput = Array.from(
			{ length: 180 },
			(_, index) => `recall-line-${index.toString().padStart(3, "0")} ${"x".repeat(80)}`,
		).join("\n");
		harness.sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "call-long",
			toolName: "read",
			content: [{ type: "text", text: longOutput }],
			isError: false,
			timestamp: Date.now(),
		});

		const recallTool = harness.session.agent.state.tools.find((tool) => tool.name === "session_recall");
		expect(recallTool).toBeDefined();
		const result = await recallTool!.execute("recall-raw", {
			query: "tool-result:call-long",
			includeRaw: true,
		});
		const text = result.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n");

		expect(text).toContain("recall-line-000");
		expect(text).toContain("recall-line-160");
		expect(text).toContain("Coverage: truncated");
	});

	it("previews compaction without mutating session entries", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 10 } },
		});
		harnesses.push(harness);
		seedCompactableSession(harness);
		const beforeEntries = harness.sessionManager.getEntries();

		const dryRun = harness.session.getCompactionDryRun();

		expect(dryRun.ok).toBe(true);
		expect(dryRun.firstKeptEntryId).toBeDefined();
		expect(dryRun.keepRecentTokens).toBeGreaterThan(0);
		expect(dryRun.projectedAfterTokens).toBeGreaterThan(0);
		expect(harness.sessionManager.getEntries()).toHaveLength(beforeEntries.length);
		expect(harness.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
	});

	it("chunks a very large history sequentially when context bounds require it", async () => {
		const smallContextModel = { id: "small-model", contextWindow: 6000, maxTokens: 1000 } as Model<any>;
		const harness = await createHarness({
			withConfiguredAuth: false,
			settings: { compaction: { keepRecentTokens: 100, reserveTokens: 1000 } },
			models: [smallContextModel],
		});
		harnesses.push(harness);

		// Seed a massive message array that exceeds the 6000 context window
		const now = Date.now();
		const hugeText = "word ".repeat(3000); // roughly 3000 tokens
		for (let i = 0; i < 4; i++) {
			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: hugeText }],
				timestamp: now - 1000 + i,
			});
			harness.sessionManager.appendMessage(
				createAssistant(harness, { stopReason: "stop", totalTokens: 3000, timestamp: now - 500 + i }),
			);
		}
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		// Configure streamFn to return a distinct summary per call to prove it iterates
		let callCount = 0;
		harness.session.agent.streamFn = (model) => {
			callCount++;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const message: AssistantMessage = {
					...fauxAssistantMessage(`summary chunk ${callCount}`),
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: createUsage(10),
				};
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const result = await harness.session.compact();

		// Should have been called multiple times (since 4 * 6000 tokens > 6000 context window)
		expect(callCount).toBeGreaterThan(1);
		expect(result.summary).toContain("<session_checkpoint>");
		expect((result.details as { markdownSummary?: string }).markdownSummary).toContain(`summary chunk ${callCount}`);
	});

	it("cancels in-progress manual compaction when abortCompaction is called", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 10 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						return await new Promise<{ cancel: true }>((resolve) => {
							event.signal.addEventListener("abort", () => resolve({ cancel: true }), { once: true });
						});
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("one ".repeat(100));
		await harness.session.prompt("two ".repeat(100));

		const compactPromise = harness.session.compact();
		await new Promise((resolve) => setTimeout(resolve, 0));
		harness.session.abortCompaction();

		await expect(compactPromise).rejects.toThrow("Compaction cancelled");
	});

	it("resumes after threshold compaction when only agent-level queued messages exist", async () => {
		vi.useFakeTimers();
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "auto compacted",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");

		harness.session.agent.followUp({
			role: "custom",
			customType: "test",
			content: [{ type: "text", text: "queued custom" }],
			display: false,
			timestamp: Date.now(),
		});

		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		await expect(sessionInternals._runAutoCompaction("threshold", false)).resolves.toBe(true);
	});

	it("does not retry overflow recovery more than once", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const overflowMessage = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "prompt is too long",
			timestamp: Date.now(),
		});
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);
		const compactionErrors: string[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "compaction_end" && event.errorMessage) {
				compactionErrors.push(event.errorMessage);
			}
		});

		await sessionInternals.checkCompaction(overflowMessage);
		await sessionInternals.checkCompaction({ ...overflowMessage, timestamp: Date.now() + 1 });

		expect(runAutoCompactionSpy).toHaveBeenCalledTimes(1);
		expect(compactionErrors).toContain(
			"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
		);
	});

	it("ignores stale pre-compaction assistant usage on pre-prompt checks", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const staleTimestamp = Date.now() - 10_000;
		const staleAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 610_000,
			timestamp: staleTimestamp,
		});

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: staleTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(staleAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction(
			"summary",
			firstKeptEntryId,
			staleAssistant.usage.totalTokens,
			undefined,
			false,
		);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "after compaction" }],
			timestamp: Date.now(),
		});

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals.checkCompaction(staleAssistant, false);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("checks threshold for new prompt text after compaction when last assistant is stale", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-small", contextWindow: 1000 }],
			settings: { compaction: { reserveTokens: 100 } },
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const staleTimestamp = Date.now() - 10_000;
		const staleAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 900,
			timestamp: staleTimestamp,
		});
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: staleTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(staleAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction("summary", firstKeptEntryId, 900, undefined, false);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals.checkCompaction(staleAssistant, false, [
			{
				role: "user",
				content: "new prompt ".repeat(600),
				timestamp: Date.now(),
			},
		]);

		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("triggers threshold compaction for error messages using the last successful usage", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const successfulAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: Date.now(),
		});
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now() + 1000,
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1000 },
			successfulAssistant,
			{ role: "user", content: [{ type: "text", text: "retry" }], timestamp: Date.now() + 500 },
			errorAssistant,
		];

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals.checkCompaction(errorAssistant);

		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("does not trigger threshold compaction for error messages when no prior usage exists", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1000 },
			errorAssistant,
		];

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals.checkCompaction(errorAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("does not trigger threshold compaction when only kept pre-compaction usage exists", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const preCompactionTimestamp = Date.now() - 10_000;
		const keptAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: preCompactionTimestamp,
		});

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: preCompactionTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(keptAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction(
			"summary",
			firstKeptEntryId,
			keptAssistant.usage.totalTokens,
			undefined,
			false,
		);

		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "kept user" }], timestamp: preCompactionTimestamp - 1000 },
			keptAssistant,
			{ role: "user", content: [{ type: "text", text: "new prompt" }], timestamp: Date.now() - 500 },
			errorAssistant,
		];

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals.checkCompaction(errorAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("does not trigger threshold compaction below the threshold or when disabled", async () => {
		const belowThresholdHarness = await createHarness({
			settings: { compaction: { enabled: true, reserveTokens: 1000 } },
			models: [{ id: "faux-1", contextWindow: 200_000 }],
		});
		harnesses.push(belowThresholdHarness);
		const disabledHarness = await createHarness({ settings: { compaction: { enabled: false } } });
		harnesses.push(disabledHarness);

		const belowThresholdInternals = belowThresholdHarness.session as unknown as SessionWithCompactionInternals;
		const disabledInternals = disabledHarness.session as unknown as SessionWithCompactionInternals;
		const belowThresholdSpy = vi.spyOn(belowThresholdInternals, "_runAutoCompaction").mockResolvedValue(false);
		const disabledSpy = vi.spyOn(disabledInternals, "_runAutoCompaction").mockResolvedValue(false);

		await belowThresholdInternals.checkCompaction(
			createAssistant(belowThresholdHarness, { stopReason: "stop", totalTokens: 1_000, timestamp: Date.now() }),
		);
		await disabledInternals.checkCompaction(
			createAssistant(disabledHarness, { stopReason: "stop", totalTokens: 1_000_000, timestamp: Date.now() }),
		);

		expect(belowThresholdSpy).not.toHaveBeenCalled();
		expect(disabledSpy).not.toHaveBeenCalled();
	});
});
