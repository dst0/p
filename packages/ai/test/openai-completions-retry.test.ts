import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { AssistantMessageEvent, Context, Model } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	requestOptions: [] as unknown[],
	requestParams: [] as unknown[],
	streamChunks: undefined as unknown[] | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown, options: unknown) => {
					mockState.requestParams.push(params);
					mockState.requestOptions.push(options);
					const chunks = mockState.streamChunks ?? [
						{
							id: "chatcmpl-test",
							choices: [{ index: 0, delta: { content: "ok" } }],
						},
						{
							id: "chatcmpl-test",
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						},
					];
					const stream = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of chunks) {
								yield chunk;
							}
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const model: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "opencode-go",
	baseUrl: "https://opencode.ai/zen/go/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const context: Context = {
	systemPrompt: "",
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
	tools: [],
};

async function consume(options?: { maxRetries?: number }) {
	const stream = streamOpenAICompletions(model, context, { apiKey: "test", ...options });
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	await stream.result();
	return events;
}

describe("openai-completions provider retries", () => {
	beforeEach(() => {
		mockState.requestOptions = [];
		mockState.requestParams = [];
		mockState.streamChunks = undefined;
	});

	it("always requests upstream progress events", async () => {
		await consume();
		expect(mockState.requestParams).toEqual([expect.objectContaining({ return_progress: true })]);
	});

	it("disables SDK retries by default", async () => {
		await consume();
		expect(mockState.requestOptions).toEqual([expect.objectContaining({ maxRetries: 0 })]);
	});

	it("honors explicit provider retry settings", async () => {
		await consume({ maxRetries: 2 });
		expect(mockState.requestOptions).toEqual([expect.objectContaining({ maxRetries: 2 })]);
	});

	it("maps orchestrator progress chunks to assistant progress events", async () => {
		mockState.streamChunks = [
			{
				id: "chatcmpl-test",
				type: "prefill_progress",
				percent: 42,
				elapsed_ms: 1500,
				tokens_per_second: 100,
				choices: [],
			},
			{
				id: "chatcmpl-test",
				type: "gen_progress",
				tokens: 3,
				tokens_per_second: 12,
				choices: [],
			},
			{
				id: "chatcmpl-test",
				type: "queue_progress",
				queue: "worker",
				position: 2,
				queued_ahead: 1,
				worker_id: "mini-pc",
				choices: [],
			},
			{
				id: "chatcmpl-test",
				choices: [{ index: 0, delta: { content: "ok" } }],
			},
			{
				id: "chatcmpl-test",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			},
		];

		const events = await consume();

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "prefill_progress",
					percent: 42,
					elapsedMs: 1500,
					tokensPerSecond: 100,
				}),
				expect.objectContaining({
					type: "gen_progress",
					tokens: 3,
					tokensPerSecond: 12,
				}),
				expect.objectContaining({
					type: "queue_progress",
					queue: "worker",
					position: 2,
					queuedAhead: 1,
					workerId: "mini-pc",
				}),
			]),
		);
	});
});
