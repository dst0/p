import { describe, expect, it } from "vitest";
import { registerApiProvider } from "./api-registry.ts";
import { streamSimple } from "./stream.ts";
import type { AssistantMessage, Context, Model } from "./types.ts";
import { AssistantMessageEventStream } from "./utils/event-stream.ts";

const TEST_API = "test-runtime-context-split";

function createDoneStream(message: AssistantMessage): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

describe("stream runtime context normalization", () => {
	it("sends volatile project context as a separate message", async () => {
		let capturedContext: Context | undefined;
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: TEST_API,
			provider: "test",
			model: "test-model",
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

		registerApiProvider({
			api: TEST_API,
			stream: (_model, context) => {
				capturedContext = context;
				return createDoneStream(assistant);
			},
			streamSimple: (_model, context) => {
				capturedContext = context;
				return createDoneStream(assistant);
			},
		});

		const model = { api: TEST_API, provider: "test", id: "test-model" } as Model<typeof TEST_API>;
		const result = await streamSimple(model, {
			systemPrompt: "stable\n\n<project_memory>\nnext step: edit stream.ts\n</project_memory>",
			messages: [{ role: "user", content: "continue", timestamp: 1 }],
		}).result();

		expect(result).toBe(assistant);
		expect(capturedContext?.systemPrompt).toBe("stable");
		expect(capturedContext?.messages).toHaveLength(2);
		expect(capturedContext?.messages[1]).toEqual({ role: "user", content: "continue", timestamp: 1 });
		expect(JSON.stringify(capturedContext?.messages[0])).toContain("<project_memory>");
		expect(JSON.stringify(capturedContext?.messages[0])).toContain("next step: edit stream.ts");
	});

	it("replays session runtime context insertions before their original user anchors", async () => {
		const capturedContexts: Context[] = [];
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: TEST_API,
			provider: "test",
			model: "test-model",
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

		registerApiProvider({
			api: TEST_API,
			stream: (_model, context) => {
				capturedContexts.push(context);
				return createDoneStream(assistant);
			},
			streamSimple: (_model, context) => {
				capturedContexts.push(context);
				return createDoneStream(assistant);
			},
		});

		const model = { api: TEST_API, provider: "test", id: "test-model" } as Model<typeof TEST_API>;
		const sessionId = "runtime-context-replay-test";
		const firstUser = { role: "user" as const, content: "turn 1", timestamp: 1 };
		const priorAssistant: AssistantMessage = { ...assistant, timestamp: 2 };
		const secondUser = { role: "user" as const, content: "turn 2", timestamp: 3 };

		await streamSimple(
			model,
			{
				systemPrompt: "stable\n\n<project_memory>\nturn one memory\n</project_memory>",
				messages: [firstUser],
			},
			{ sessionId },
		).result();
		await streamSimple(
			model,
			{
				systemPrompt: "stable\n\n<project_memory>\nturn two memory\n</project_memory>",
				messages: [firstUser, priorAssistant, secondUser],
			},
			{ sessionId },
		).result();

		expect(capturedContexts).toHaveLength(2);
		expect(capturedContexts[1].systemPrompt).toBe("stable");
		expect(capturedContexts[1].messages).toHaveLength(5);
		expect(JSON.stringify(capturedContexts[1].messages[0])).toContain("turn one memory");
		expect(capturedContexts[1].messages[1]).toEqual(firstUser);
		expect(capturedContexts[1].messages[2]).toEqual(priorAssistant);
		expect(JSON.stringify(capturedContexts[1].messages[3])).toContain("turn two memory");
		expect(capturedContexts[1].messages[4]).toEqual(secondUser);
	});
});
