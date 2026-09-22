import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  bindCertifiedModelConfiguration,
  recheckCertifiedModelConfiguration,
} from "../../src/workloads/certification-model-config.ts";

const expectedModel = "mini-pc/sokann-qwen-27b";
const kiloModel = "llm-orchestrator/sokann-qwen-27b";

test("certified model configuration accepts JSONC parity and binds stable raw-input evidence", () => {
  const fixture = createFixture();
  try {
    const first = bind(fixture);
    const second = bind(fixture);
    assert.match(first.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(second.sha256, first.sha256);
    recheckCertifiedModelConfiguration(first);

    writeFileSync(fixture.kiloConfig, `${kiloConfiguration()}\n// equivalent configuration comment\n`);
    const changed = bind(fixture);
    assert.notEqual(changed.sha256, first.sha256);
    assert.throws(() => recheckCertifiedModelConfiguration(first), /raw input changed/u);
  } finally {
    fixture.dispose();
  }
});

test("certified model configuration rejects semantic P-versus-Kilo mismatches", () => {
  const fixture = createFixture();
  try {
    for (const kilo of [
      kiloConfiguration({ context: 65_536 }),
      kiloConfiguration({ output: 4_096 }),
      kiloConfiguration({ reasoning: true }),
      kiloConfiguration({ toolCall: false }),
      kiloConfiguration({ input: ["text", "image"] }),
      kiloConfiguration({ temperature: 0.2 }),
      kiloConfiguration({ baseUrl: "http://different-backend.test/v1" }),
    ]) {
      writeFileSync(fixture.kiloConfig, kilo);
      assert.throws(() => bind(fixture), /model configuration parity mismatch/u);
    }
  } finally {
    fixture.dispose();
  }
});

test("certified model configuration fails closed on missing or malformed private inputs without leaking secrets", () => {
  const fixture = createFixture();
  const secret = "CERTIFICATION_CONFIG_SECRET_MUST_NOT_LEAK";
  try {
    rmSync(fixture.modelsFile);
    assert.throws(() => bind(fixture), /P model configuration is missing/u);

    writeFileSync(fixture.modelsFile, pConfiguration());
    writeFileSync(fixture.kiloConfig, `{ model: "${kiloModel}", token: "${secret}"`);
    assert.throws(
      () => bind(fixture),
      (error: unknown) => error instanceof Error && /Kilo model configuration is malformed/u.test(error.message),
    );
    try {
      bind(fixture);
    } catch (error) {
      assert.equal(error instanceof Error && error.message.includes(secret), false);
    }
  } finally {
    fixture.dispose();
  }
});

function bind(fixture: ReturnType<typeof createFixture>) {
  return bindCertifiedModelConfiguration({
    modelsFile: fixture.modelsFile,
    kiloConfig: fixture.kiloConfig,
    model: expectedModel,
    kiloModel,
    expectedResolvedModel: expectedModel,
  });
}

function createFixture(): { root: string; modelsFile: string; kiloConfig: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "certified-model-config-"));
  const modelsFile = join(root, "models.json");
  const kiloConfig = join(root, "kilo.jsonc");
  writeFileSync(modelsFile, pConfiguration());
  writeFileSync(kiloConfig, kiloConfiguration());
  return { root, modelsFile, kiloConfig, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function pConfiguration(): string {
  return JSON.stringify({
    providers: {
      "mini-pc": {
        api: "openai-completions",
        baseUrl: "http://model.test/v1",
        models: [
          {
            id: "sokann-qwen-27b",
            contextWindow: 131_072,
            maxTokens: 8_192,
            reasoning: false,
            input: ["text"],
          },
        ],
      },
    },
  });
}

function kiloConfiguration(
  overrides: {
    context?: number;
    output?: number;
    reasoning?: boolean;
    toolCall?: boolean;
    input?: string[];
    temperature?: number;
    baseUrl?: string;
  } = {},
): string {
  const temperature = overrides.temperature === undefined ? "" : `"temperature": ${overrides.temperature}`;
  return `{
    // Kilo accepts JSONC configuration.
    "model": "${kiloModel}",
    "provider": {
      "llm-orchestrator": {
        "npm": "@ai-sdk/openai-compatible",
        "options": { "baseURL": "${overrides.baseUrl ?? "http://model.test/v1"}" },
        "models": {
          "sokann-qwen-27b": {
            "name": "Sokann Qwen",
            "reasoning": ${overrides.reasoning ?? false},
            "tool_call": ${overrides.toolCall ?? true},
            "modalities": { "input": ${JSON.stringify(overrides.input ?? ["text"])}, "output": ["text"] },
            "limit": { "context": ${overrides.context ?? 131_072}, "output": ${overrides.output ?? 8_192} },
            "options": { ${temperature} },
          },
        },
      },
    },
  }`;
}
