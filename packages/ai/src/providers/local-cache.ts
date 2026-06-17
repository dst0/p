import type { Api, Model } from "../types.ts";
import type { OpenAICompletionsOptions } from "./openai-completions.ts";

export interface LocalPromptCacheOptions {
	/** Server slot id. Keep the same id for the same conversation. */
	idSlot?: number;
	/** Whether to send the provider cache flag. Defaults to true. */
	enabled?: boolean;
}

type MutablePayload = Record<string, unknown>;

function isMutablePayload(value: unknown): value is MutablePayload {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adds local OpenAI-compatible prompt cache fields through `onPayload`.
 *
 * This keeps cache reuse opt-in and provider-specific without changing the
 * generic OpenAI-compatible request builder for every endpoint.
 */
export function withLocalPromptCache(
	options: OpenAICompletionsOptions = {},
	cacheOptions: LocalPromptCacheOptions = {},
): OpenAICompletionsOptions {
	const enabled = cacheOptions.enabled ?? true;
	const idSlot = cacheOptions.idSlot;
	if (idSlot !== undefined && (!Number.isInteger(idSlot) || idSlot < 0)) {
		throw new TypeError("idSlot must be a non-negative integer");
	}

	return {
		cacheRetention: options.cacheRetention ?? (enabled ? "short" : "none"),
		...options,
		onPayload: async (payload: unknown, model: Model<Api>) => {
			const transformedPayload = await options.onPayload?.(payload, model);
			const nextPayload = transformedPayload === undefined ? payload : transformedPayload;
			if (!isMutablePayload(nextPayload)) {
				return nextPayload;
			}

			return {
				...nextPayload,
				cache_prompt: enabled && (options.cacheRetention ?? "short") !== "none",
				...(idSlot !== undefined ? { id_slot: idSlot } : {}),
			};
		},
	};
}
