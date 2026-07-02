import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Message,
	type Model,
	type Usage,
} from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "../src/types.ts";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<string> = {
	id: "main",
	name: "Main",
	api: "faux",
	provider: "faux",
	baseUrl: "http://localhost:0",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function isLlmMessage(message: AgentMessage): message is Message {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function createColdPrefillStream(message: AssistantMessage): StreamFn {
	return () => {
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const partial: AssistantMessage = { ...message, content: [] };
			stream.push({ type: "start", partial });
			stream.push({
				type: "prefill_progress",
				elapsedMs: 750,
				percent: 5,
				tokens: 2048,
				cachedTokens: 0,
				cold: true,
				partial,
			});
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
}

describe("cold prefill events", () => {
	it("emits a cold_prefill_detected update when prefill progress proves a cache miss", async () => {
		const events: AgentEvent[] = [];
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model,
			completionMode: "implicit",
			convertToLlm: (messages) => messages.filter(isLlmMessage),
		};
		const stream = agentLoop(
			[userMessage("summarize the repository")],
			context,
			config,
			undefined,
			createColdPrefillStream(assistantMessage("ok")),
		);

		for await (const event of stream) {
			events.push(event);
		}

		const coldEvents = events
			.filter((event): event is Extract<AgentEvent, { type: "message_update" }> => event.type === "message_update")
			.map((event) => event.assistantMessageEvent)
			.filter((event) => event.type === "cold_prefill_detected");

		expect(coldEvents).toEqual([
			expect.objectContaining({
				type: "cold_prefill_detected",
				elapsedMs: 750,
				tokens: 2048,
				cachedTokens: 0,
				reason: "cache_miss",
			}),
		]);
	});
});
