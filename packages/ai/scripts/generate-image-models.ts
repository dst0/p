#!/usr/bin/env node

import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ImagesModel } from "../src/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface OpenRouterModelRecord {
	id: string;
	name: string;
	context_length?: number;
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[];
	};
	pricing?: {
		prompt?: string;
		completion?: string;
		input_cache_read?: string;
		input_cache_write?: string;
	};
}

const STATIC_OPENAI_MODELS: ImagesModel<"openai-images">[] = [
	{
		id: "gpt-image-2",
		name: "OpenAI: GPT Image 2",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		output: ["image"],
		cost: { input: 0, output: 0.04, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "dall-e-3",
		name: "OpenAI: DALL-E 3",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0.04, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "dall-e-2",
		name: "OpenAI: DALL-E 2",
		api: "openai-images",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0.02, cacheRead: 0, cacheWrite: 0 },
	},
];

const STATIC_LLM_ORC_MODELS: ImagesModel<"openai-images">[] = [
	{
		id: "dall-e-3",
		name: "LLM Orchestrator: DALL-E 3",
		api: "openai-images",
		provider: "llm-orchestrator",
		baseUrl: "https://llm-orc.dst.lan/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "flux.1-schnell",
		name: "LLM Orchestrator: FLUX.1 Schnell",
		api: "openai-images",
		provider: "llm-orchestrator",
		baseUrl: "https://llm-orc.dst.lan/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "flux.1-dev",
		name: "LLM Orchestrator: FLUX.1 Dev",
		api: "openai-images",
		provider: "llm-orchestrator",
		baseUrl: "https://llm-orc.dst.lan/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
];

async function fetchOpenRouterImageModels(): Promise<ImagesModel<"openrouter-images">[]> {
	try {
		console.log("Fetching image models from OpenRouter API...");
		const response = await fetch(`${OPENROUTER_BASE_URL}/models?output_modalities=image`);
		const data = (await response.json()) as { data?: OpenRouterModelRecord[] };
		const models: ImagesModel<"openrouter-images">[] = [];

		for (const model of data.data ?? []) {
			const input = Array.from(
				new Set(
					(model.architecture?.input_modalities ?? [])
						.filter((modality): modality is "text" | "image" => modality === "text" || modality === "image"),
				),
			);
			const output = Array.from(
				new Set(
					(model.architecture?.output_modalities ?? []).filter(
						(modality): modality is "text" | "image" => modality === "text" || modality === "image",
					),
				),
			);

			if (!output.includes("image")) continue;
			if (input.length === 0) input.push("text");

			models.push({
				id: model.id,
				name: model.name,
				api: "openrouter-images",
				provider: "openrouter",
				baseUrl: OPENROUTER_BASE_URL,
				input,
				output,
				cost: {
					input: parseFloat(model.pricing?.prompt || "0") * 1_000_000,
					output: parseFloat(model.pricing?.completion || "0") * 1_000_000,
					cacheRead: parseFloat(model.pricing?.input_cache_read || "0") * 1_000_000,
					cacheWrite: parseFloat(model.pricing?.input_cache_write || "0") * 1_000_000,
				},
			});
		}

		console.log(`Fetched ${models.length} image models from OpenRouter`);
		return models;
	} catch (error) {
		console.error("Failed to fetch OpenRouter image models:", error);
		return [];
	}
}

function serializeModelMap(models: ImagesModel<any>[]): Record<string, string> {
	const serializeStringArray = (values: readonly string[]): string =>
		`[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
	const serializeCost = (cost: ImagesModel<any>["cost"]): string => `{
				input: ${cost.input},
				output: ${cost.output},
				cacheRead: ${cost.cacheRead},
				cacheWrite: ${cost.cacheWrite},
			}`;

	return Object.fromEntries(
		models
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((model) => [
				model.id,
				`{
			id: ${JSON.stringify(model.id)},
			name: ${JSON.stringify(model.name)},
			api: ${JSON.stringify(model.api)},
			provider: ${JSON.stringify(model.provider)},
			baseUrl: ${JSON.stringify(model.baseUrl)},
			input: ${serializeStringArray(model.input)},
			output: ${serializeStringArray(model.output)},
			cost: ${serializeCost(model.cost)},
		} satisfies ImagesModel<${JSON.stringify(model.api)}>`,
			]),
	);
}

function generateImageModelsFile(openRouterModels: ImagesModel<"openrouter-images">[]): string {
	const imageModelsByProvider = {
		openrouter: serializeModelMap(openRouterModels),
		openai: serializeModelMap(STATIC_OPENAI_MODELS),
		"llm-orchestrator": serializeModelMap(STATIC_LLM_ORC_MODELS),
	};

	const providerEntries = Object.entries(imageModelsByProvider)
		.map(([provider, providerModels]) => {
			const modelEntries = Object.entries(providerModels)
				.map(([id, serialized]) => `\t\t${JSON.stringify(id)}: ${serialized},`)
				.join("\n");
			return `\t${JSON.stringify(provider)}: {\n${modelEntries}\n\t},`;
		})
		.join("\n");

	return `// This file is auto-generated by scripts/generate-image-models.ts
// Do not edit manually - run 'npm run generate-image-models' to update

import type { ImagesApi, ImagesModel } from "./types.ts";

export const IMAGE_MODELS = {
${providerEntries}
} as const satisfies Record<string, Record<string, ImagesModel<ImagesApi>>>;
`;
}

async function main(): Promise<void> {
	const openRouterModels = await fetchOpenRouterImageModels();
	const output = generateImageModelsFile(openRouterModels);
	const outputPath = join(packageRoot, "src", "image-models.generated.ts");
	writeFileSync(outputPath, output, "utf-8");
	console.log(`Generated ${outputPath}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
