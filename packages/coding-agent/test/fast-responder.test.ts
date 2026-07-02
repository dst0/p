import type { Message, Model } from "@dst0/p-ai";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { type CustomMessage, FAST_RESPONDER_CUSTOM_TYPE } from "../src/core/messages.ts";
import { createHarness, getMessageText, type Harness } from "./suite/harness.ts";

function textFromMessages(messages: Message[]): string {
	return messages.map((message) => getMessageText(message)).join("\n");
}

function isFastResponderMessage(message: unknown): message is CustomMessage {
	return (
		typeof message === "object" &&
		message !== null &&
		"role" in message &&
		message.role === "custom" &&
		"customType" in message &&
		message.customType === FAST_RESPONDER_CUSTOM_TYPE
	);
}

describe("fast responder", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("uses the configured fast model and keeps the responder text out of the main LLM context", async () => {
		const responderText = "Понял: нужно внедрить быстрый ответ на cold prefill. Начинаю с проверки входного запроса.";
		const requestedModels: string[] = [];
		let mainModelContext: Message[] | undefined;

		const harness = await createHarness({
			completionMode: "implicit",
			models: [
				{ id: "main", name: "Main model", reasoning: false },
				{ id: "micro", name: "Micro responder", reasoning: false },
			],
			settings: {
				fastResponder: {
					model: "micro",
					minContextTokens: 1,
					timeoutMs: 1000,
					maxTokens: 80,
				},
			},
		});
		harnesses.push(harness);

		harness.setResponses([
			(_context, _options, _state, model: Model<string>) => {
				requestedModels.push(model.id);
				return fauxAssistantMessage(responderText);
			},
			(context, _options, _state, model: Model<string>) => {
				requestedModels.push(model.id);
				mainModelContext = context.messages;
				return fauxAssistantMessage("main done");
			},
		]);

		await harness.session.prompt("Внедри cold prefill detector и fast local responder.");

		expect(requestedModels).toEqual(["micro", "main"]);
		const fastResponderMessage = harness.session.messages.find(isFastResponderMessage);

		expect(fastResponderMessage).toBeDefined();
		expect(fastResponderMessage?.display).toBe(true);
		expect(getMessageText(fastResponderMessage)).toBe(responderText);
		expect(textFromMessages(mainModelContext ?? [])).not.toContain(responderText);
	});
});
