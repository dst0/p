import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ts from "typescript";

export const options = {
  model: "compiler/model/v3",
  kiloModel: "kilo-provider/alias-v2",
  expectedResolvedModel: "model/v3",
};

export function makeDirectories(
  upstreams = ["https://upstream.invalid/v1", "https://upstream.invalid/v1"],
  kiloUpstream = "https://upstream.invalid/v1",
): {
  root: string;
  dirs: Record<string, string>;
  sourceFiles: Record<string, string>;
  sourceContents: Record<string, string>;
} {
  const root = mkdtempSync(join(tmpdir(), "certified-proxy-config-test-"));
  const dirs: Record<string, string> = {};
  for (const agent of ["p", "pi", "kilo"]) {
    dirs[agent] = join(root, agent);
    mkdirSync(dirs[agent], { recursive: true });
  }
  const provider = (baseUrl: string) => ({
    api: "openai-completions",
    baseUrl,
    apiKey: "canonical-test-key",
    headers: { "x-api-key": "provider-header-test" },
    models: [
      {
        id: "model/v3",
        name: "compiler model",
        reasoning: true,
        input: ["text"],
        contextWindow: 8192,
        maxTokens: 4096,
        compat: { thinkingFormat: "qwen" },
        headers: { "x-custom-token": "model-header-test" },
      },
    ],
  });
  const pModels = JSON.stringify({
    providers: {
      compiler: provider(upstreams[0] ?? ""),
      unused: {
        api: "openai-completions",
        baseUrl: "https://unused.invalid/v1",
        apiKey: "unrelated-test-key",
        headers: { Authorization: "Bearer unrelated-header-test" },
        models: [{ id: "unused-model", apiKey: "nested-test-key" }],
      },
    },
  });
  const piModels = JSON.stringify({
    providers: {
      compiler: provider(upstreams[1] ?? ""),
      unused: {
        api: "openai-completions",
        baseUrl: "https://unused.invalid/v1",
        apiKey: "unrelated-test-key",
        headers: { Authorization: "Bearer unrelated-header-test" },
        models: [{ id: "unused-model", apiKey: "nested-test-key" }],
      },
    },
  });
  const kiloConfig = `{
    // Kept while the copied config is rewritten.
    "model": "kilo-provider/alias-v2",
    "provider": {
      "kilo-provider": {
        "npm": "@ai-sdk/openai-compatible",
        "options": { "baseURL": "${kiloUpstream}", "apiKey": "old-kilo-key", "timeout": false, "chunkTimeout": 120000, "headers": { "x-api-key": "kilo-header-test" } },
        "models": { "alias-v2": { "id": "old-id", "name": "alias", "reasoning": true, "tool_call": true, "temperature": true, "attachment": false, "limit": { "context": 8192, "output": 4096 }, "modalities": { "input": ["text"], "output": ["text"] }, "apiKey": "nested-kilo-key", "headers": { "x-custom-token": "kilo-model-header" } } }
      }
    },
    "unused-provider": {
      "options": { "baseURL": "https://unused.invalid/v1", "apiKey": "unrelated-kilo-key", "headers": { "Authorization": "Bearer unrelated-header" } }
    }
  }`;
  const sourceFiles = {
    p: join(root, "source-models.json"),
    pi: join(root, "source-pi-models.json"),
    kilo: join(root, "source-kilo.jsonc"),
  };
  const sourceContents = { p: `${pModels}\n`, pi: `${piModels}\n`, kilo: `${kiloConfig}\n` };
  writeFileSync(sourceFiles.p, sourceContents.p);
  writeFileSync(sourceFiles.pi, sourceContents.pi);
  writeFileSync(sourceFiles.kilo, sourceContents.kilo);
  copyFileSync(sourceFiles.p, join(dirs.p, "models.json"));
  copyFileSync(sourceFiles.pi, join(dirs.pi, "models.json"));
  mkdirSync(join(dirs.kilo, "config", "kilo"), { recursive: true });
  copyFileSync(sourceFiles.kilo, join(dirs.kilo, "config", "kilo", "kilo.jsonc"));
  return { root, dirs, sourceFiles, sourceContents };
}

export function readJsonc(path: string): Record<string, unknown> {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  assert.equal(parsed.error, undefined);
  assert.ok(parsed.config && typeof parsed.config === "object");
  return parsed.config as Record<string, unknown>;
}

export function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function apiKeyValues(value: unknown, result: unknown[] = []): unknown[] {
  return nestedPropertyValues(value, "apiKey", result);
}

export function nestedPropertyValues(value: unknown, key: string, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const child of value) nestedPropertyValues(child, key, result);
  } else if (value !== null && typeof value === "object") {
    for (const [property, child] of Object.entries(value as Record<string, unknown>)) {
      if (property === key) result.push(child);
      nestedPropertyValues(child, key, result);
    }
  }
  return result;
}
