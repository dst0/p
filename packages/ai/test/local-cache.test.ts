import { describe, expect, it, vi } from "vitest";
import { withLocalPromptCache } from "../src/providers/local-cache.ts";
import type { Model } from "../src/types.ts";

const model = {
	id: "local-test-model",
	name: "Local Test Model",
	api: "openai-completions",
	provider: "local-test",
	baseUrl: "http://127.0.0.1:8080/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 1024,
} satisfies Model<"openai-completions">;

describe("withLocalPromptCache", () => {
	it("defaults to short cache retention and adds local cache fields", async () => {
		const options = withLocalPromptCache({ apiKey: "unused" }, { idSlot: 7 });
		const payload = await options.onPayload?.({ model: model.id }, model);

		expect(options.cacheRetention).toBe("short");
		expect(payload).toEqual({
			model: model.id,
			cache_prompt: true,
			id_slot: 7,
		});
	});

	it("preserves transformed payloads from an existing onPayload callback", async () => {
		const onPayload = vi.fn(async (payload: unknown) => ({
			...(payload as Record<string, unknown>),
			transformed: true,
		}));
		const options = withLocalPromptCache({
			onPayload,
		});
		const payload = await options.onPayload?.({ original: true }, model);

		expect(onPayload).toHaveBeenCalledWith({ original: true }, model);
		expect(payload).toEqual({
			original: true,
			transformed: true,
			cache_prompt: true,
		});
	});

	it("uses the effective cache retention when disabled", async () => {
		const options = withLocalPromptCache({}, { enabled: false });
		const payload = await options.onPayload?.({ model: model.id }, model);

		expect(options.cacheRetention).toBe("none");
		expect(payload).toEqual({
			model: model.id,
			cache_prompt: false,
		});
	});

	it("disables provider cache fields when cache retention is none", async () => {
		const options = withLocalPromptCache({ cacheRetention: "none" });
		const payload = await options.onPayload?.({ model: model.id }, model);

		expect(options.cacheRetention).toBe("none");
		expect(payload).toEqual({
			model: model.id,
			cache_prompt: false,
		});
	});

	it("returns immutable payloads unchanged", async () => {
		const options = withLocalPromptCache();

		await expect(options.onPayload?.("payload", model)).resolves.toBe("payload");
		await expect(options.onPayload?.(["payload"], model)).resolves.toEqual(["payload"]);
	});

	it("returns immutable payloads from an existing onPayload callback unchanged", async () => {
		const options = withLocalPromptCache({ onPayload: async () => "raw" });

		await expect(options.onPayload?.({}, model)).resolves.toBe("raw");
	});

	it("rejects invalid slot ids", () => {
		expect(() => withLocalPromptCache({}, { idSlot: -1 })).toThrow("idSlot must be a non-negative integer");
		expect(() => withLocalPromptCache({}, { idSlot: 1.5 })).toThrow("idSlot must be a non-negative integer");
	});
});
