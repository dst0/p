import { describe, expect, it } from "vitest";
import { withLocalPromptCache } from "../src/providers/local-cache.ts";
import type { Model } from "../src/types.ts";

const model = {
	id: "local-model",
	name: "local-model",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://127.0.0.1:8080/v1",
} as Model<"openai-completions">;

describe("withLocalPromptCache", () => {
	it("adds local cache fields to mutable payloads", async () => {
		const options = withLocalPromptCache({}, { idSlot: 7 });
		const payload = await options.onPayload?.({ model: "local-model" }, model);

		expect(payload).toEqual({
			model: "local-model",
			cache_prompt: true,
			id_slot: 7,
		});
	});

	it("preserves transformed payloads from an existing onPayload callback", async () => {
		const options = withLocalPromptCache({
			onPayload: () => ({ transformed: true }),
		});
		const payload = await options.onPayload?.({ original: true }, model);

		expect(payload).toEqual({
			transformed: true,
			cache_prompt: true,
		});
	});

	it("disables provider cache fields when cache retention is none", async () => {
		const options = withLocalPromptCache({ cacheRetention: "none" });
		const payload = await options.onPayload?.({ model: "local-model" }, model);

		expect(options.cacheRetention).toBe("none");
		expect(payload).toEqual({
			model: "local-model",
			cache_prompt: false,
		});
	});

	it("returns immutable payloads unchanged", async () => {
		const options = withLocalPromptCache();

		await expect(options.onPayload?.("payload", model)).resolves.toBe("payload");
		await expect(options.onPayload?.(["payload"], model)).resolves.toEqual(["payload"]);
	});

	it("rejects invalid slot ids", () => {
		expect(() => withLocalPromptCache({}, { idSlot: -1 })).toThrow(TypeError);
		expect(() => withLocalPromptCache({}, { idSlot: 1.5 })).toThrow(TypeError);
	});
});
