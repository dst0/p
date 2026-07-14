import { describe, expect, it } from "vitest";
import type { AssistantMessage, Model } from "../types.ts";
import { parseOpenAICompletionsProgressChunk, streamSimpleOpenAICompletions } from "./openai-completions.ts";

function createLocalMiniPcModel(): Model<"openai-completions"> {
	return {
		id: "mini-pc/qwen3.6-27b-iq4xs-q4kv",
		name: "mini-pc/qwen3.6-27b-iq4xs-q4kv",
		api: "openai-completions",
		provider: "mini-pc-11450",
		baseUrl: "http://192.168.8.167:11450/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 65_536,
		maxTokens: 16_384,
	};
}

describe("openai completions local llama cache compatibility", () => {
	it("parses llm-orchestrator queue position progress chunks", () => {
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-completions",
			provider: "mini-pc-11450",
			model: "mini-pc/qwen3.6-27b-iq4xs-q4kv",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 0,
		};

		const event = parseOpenAICompletionsProgressChunk(
			{
				type: "queue_progress",
				position: 3,
				queued_ahead: 2,
				queued_at_ms: 1_700_000_000_000,
				queued_for_ms: 4250,
				ticket_id: "queue-ticket-a",
				queue: "worker-queue",
				worker_id: "llama-gpu",
			} as unknown as Parameters<typeof parseOpenAICompletionsProgressChunk>[0],
			assistant,
		);

		expect(event).toEqual({
			type: "queue_progress",
			queue: "worker-queue",
			position: 3,
			queuedAhead: 2,
			queuedAtMs: 1_700_000_000_000,
			queuedForMs: 4250,
			ticketId: "queue-ticket-a",
			workerId: "llama-gpu",
			partial: assistant,
		});
	});

	it("enables llama cache_prompt for local discovered mini-pc models", async () => {
		let capturedPayload: Record<string, unknown> | undefined;
		const stream = streamSimpleOpenAICompletions(
			createLocalMiniPcModel(),
			{
				systemPrompt: "stable instructions",
				messages: [{ role: "user", content: "continue", timestamp: 1 }],
			},
			{
				apiKey: "ollama",
				sessionId: "cache-session-a",
				cacheRetention: "short",
				onPayload: (payload) => {
					capturedPayload = payload as Record<string, unknown>;
					throw new Error("stop after payload capture");
				},
			},
		);

		await stream.result();

		expect(capturedPayload).toBeDefined();
		expect(capturedPayload?.cache_prompt).toBe(true);
	});

	it("drops interrupted assistant tool calls without synthesizing unstable tool results", async () => {
		let capturedPayload: { messages?: Array<{ role?: string }> } | undefined;
		const interruptedAssistant: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_interrupted",
					name: "read",
					arguments: { path: "a.txt" },
				},
			],
			api: "openai-completions",
			provider: "mini-pc-11450",
			model: "mini-pc/qwen3.6-27b-iq4xs-q4kv",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "aborted",
			timestamp: 2,
		};

		const stream = streamSimpleOpenAICompletions(
			createLocalMiniPcModel(),
			{
				systemPrompt: "stable instructions",
				messages: [
					{ role: "user", content: "start", timestamp: 1 },
					interruptedAssistant,
					{ role: "user", content: "continue after interruption", timestamp: 3 },
				],
			},
			{
				apiKey: "ollama",
				sessionId: "cache-session-interrupted",
				cacheRetention: "short",
				onPayload: (payload) => {
					capturedPayload = payload as { messages?: Array<{ role?: string }> };
					throw new Error("stop after payload capture");
				},
			},
		);

		await stream.result();

		expect(capturedPayload?.messages?.map((message) => message.role)).toEqual(["system", "user", "user"]);
	});
});
