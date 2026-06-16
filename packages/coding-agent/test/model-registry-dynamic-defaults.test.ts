import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";

describe("ModelRegistry dynamic provider defaults", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-model-registry-defaults-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = join(tempDir, "models.json");
		authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	test("registerProvider applies defaults to minimal model definitions", () => {
		const registry = ModelRegistry.create(authStorage, modelsJsonPath);

		registry.registerProvider("minimal-provider", {
			baseUrl: "https://provider.test/v1",
			apiKey: "test-key",
			api: "openai-completions",
			models: [{ id: "minimal-model" }],
		});

		const model = registry.find("minimal-provider", "minimal-model");
		expect(model).toMatchObject({
			id: "minimal-model",
			name: "minimal-model",
			api: "openai-completions",
			provider: "minimal-provider",
			baseUrl: "https://provider.test/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		});
		expect(model?.input.includes("image")).toBe(false);
	});
});
