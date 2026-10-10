import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as ts from "typescript";
import { readCertifiedProxyConfig, rewriteCertifiedAgentConfigs } from "../../src/harness/certified-proxy-config.ts";

const options = {
  model: "compiler/model/v3",
  kiloModel: "kilo-provider/alias-v2",
  expectedResolvedModel: "model/v3",
};

function makeDirectories(
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
  const pModels = JSON.stringify({
    providers: {
      compiler: {
        api: "openai-completions",
        baseUrl: upstreams[0],
        apiKey: "canonical-test-key",
        models: [{ id: "model/v3", name: "compiler model" }],
      },
      unused: {
        api: "openai-completions",
        baseUrl: "https://unused.invalid/v1",
        apiKey: "unrelated-test-key",
        models: [{ id: "unused-model", apiKey: "nested-test-key" }],
      },
    },
  });
  const piModels = JSON.stringify({
    providers: {
      compiler: {
        api: "openai-completions",
        baseUrl: upstreams[1],
        apiKey: "canonical-test-key",
        models: [{ id: "model/v3", name: "compiler model" }],
      },
      unused: {
        api: "openai-completions",
        baseUrl: "https://unused.invalid/v1",
        apiKey: "unrelated-test-key",
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
        "options": { "baseURL": "${kiloUpstream}", "apiKey": "old-kilo-key" },
        "models": { "alias-v2": { "id": "old-id", "name": "alias", "apiKey": "nested-kilo-key" } }
      }
    },
    "unused-provider": {
      "options": { "baseURL": "https://unused.invalid/v1", "apiKey": "unrelated-kilo-key" }
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

function readJsonc(path: string): Record<string, unknown> {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  assert.equal(parsed.error, undefined);
  assert.ok(parsed.config && typeof parsed.config === "object");
  return parsed.config as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function apiKeyValues(value: unknown, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const child of value) apiKeyValues(child, result);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "apiKey") result.push(child);
      apiKeyValues(child, result);
    }
  }
  return result;
}

test("certified proxy config rejects mismatched provider routes and model overrides", () => {
  const mismatch = makeDirectories(["https://upstream.invalid/v1", "https://other.invalid/v1"]);
  try {
    assert.throws(() => readCertifiedProxyConfig(options, mismatch.dirs), /upstream/u);
  } finally {
    rmSync(mismatch.root, { recursive: true, force: true });
  }

  const differentKiloSource = makeDirectories(undefined, "http://other.invalid/v1");
  try {
    assert.equal(
      readCertifiedProxyConfig(options, differentKiloSource.dirs).upstreamBaseUrl,
      "https://upstream.invalid/v1",
    );
    rewriteCertifiedAgentConfigs(options, differentKiloSource.dirs, "http://localhost:43210/v1");
    const kilo = readJsonc(join(differentKiloSource.dirs.kilo, "config", "kilo", "kilo.jsonc"));
    const provider = record(record(kilo.provider)["kilo-provider"]);
    assert.equal(record(provider.options).baseURL, "http://localhost:43210/v1");
  } finally {
    rmSync(differentKiloSource.root, { recursive: true, force: true });
  }

  const override = makeDirectories();
  try {
    const path = join(override.dirs.p, "models.json");
    const models = JSON.parse(readFileSync(path, "utf8")) as {
      providers: { compiler: { models: Array<Record<string, unknown>> } };
    };
    models.providers.compiler.models[0].baseUrl = "https://override.invalid/v1";
    writeFileSync(path, `${JSON.stringify(models)}\n`);
    assert.throws(() => readCertifiedProxyConfig(options, override.dirs), /model baseUrl/u);
  } finally {
    rmSync(override.root, { recursive: true, force: true });
  }

  const keyMismatch = makeDirectories();
  try {
    const path = join(keyMismatch.dirs.pi, "models.json");
    const models = JSON.parse(readFileSync(path, "utf8")) as {
      providers: { compiler: { apiKey: string } };
    };
    models.providers.compiler.apiKey = "different-test-key";
    writeFileSync(path, `${JSON.stringify(models)}\n`);
    assert.throws(() => readCertifiedProxyConfig(options, keyMismatch.dirs), /canonical API keys/u);
  } finally {
    rmSync(keyMismatch.root, { recursive: true, force: true });
  }

  const wrongModel = makeDirectories();
  try {
    assert.throws(
      () => readCertifiedProxyConfig({ ...options, expectedResolvedModel: "compiler/other" }, wrongModel.dirs),
      /expected resolved model/u,
    );
  } finally {
    rmSync(wrongModel.root, { recursive: true, force: true });
  }

  const unsupportedApi = makeDirectories();
  try {
    const path = join(unsupportedApi.dirs.p, "models.json");
    const models = JSON.parse(readFileSync(path, "utf8")) as {
      providers: { compiler: { api: string } };
    };
    models.providers.compiler.api = "openai-responses";
    writeFileSync(path, `${JSON.stringify(models)}\n`);
    assert.throws(() => readCertifiedProxyConfig(options, unsupportedApi.dirs), /provider API is unsupported/u);
  } finally {
    rmSync(unsupportedApi.root, { recursive: true, force: true });
  }
});

test("certified proxy config rejects unsafe upstream URLs without disclosing them", () => {
  for (const upstream of [
    "http://upstream.invalid/v1",
    "https://user:password@upstream.invalid/v1",
    "https://upstream.invalid/v1?token=hidden",
    "https://upstream.invalid/v1?",
    "https://upstream.invalid/v1#fragment",
    "https://upstream.invalid/v1#",
  ]) {
    const fixture = makeDirectories([upstream, upstream]);
    try {
      assert.throws(
        () => readCertifiedProxyConfig(options, fixture.dirs),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message.includes(upstream), false);
          assert.equal(error.message.includes("password"), false);
          return true;
        },
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("certified proxy config never copies the canonical key when P has no source key", () => {
  const fixture = makeDirectories();
  try {
    for (const agent of ["p", "pi"] as const) {
      const path = join(fixture.dirs[agent], "models.json");
      const models = JSON.parse(readFileSync(path, "utf8")) as {
        providers: { compiler: { apiKey?: string } };
      };
      delete models.providers.compiler.apiKey;
      writeFileSync(path, `${JSON.stringify(models)}\n`);
    }
    assert.equal("apiKey" in readCertifiedProxyConfig(options, fixture.dirs), false);
    assert.throws(
      () => rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://remote.invalid:43210/v1"),
      /local HTTP endpoint/u,
    );
    rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1");
    const kiloPath = join(fixture.dirs.kilo, "config", "kilo", "kilo.jsonc");
    const kilo = readJsonc(kiloPath);
    const provider = record(record(kilo.provider)["kilo-provider"]);
    assert.equal(record(provider.options).apiKey, "benchmark-proxy");
    assert.deepEqual(apiKeyValues(kilo), ["benchmark-proxy"]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("certified proxy config resolves aliases and rewrites missing Kilo model fields", () => {
  const fixture = makeDirectories();
  try {
    const kiloPath = join(fixture.dirs.kilo, "config", "kilo", "kilo.jsonc");
    writeFileSync(
      kiloPath,
      `{
        "model": "kilo-provider/alias-v2",
        "provider": {
          "kilo-provider": {
            "npm": "@ai-sdk/openai-compatible",
            "options": { "baseURL": "http://legacy.invalid/v1", },
            "models": { "alias-v2": { "name": "alias", }, },
          },
        },
      }\n`,
    );
    rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1");
    const rewritten = readJsonc(kiloPath);
    const rewrittenProvider = record(record(rewritten.provider)["kilo-provider"]);
    assert.equal(record(rewrittenProvider.options).apiKey, "benchmark-proxy");
    assert.equal(record(record(rewrittenProvider.models)["alias-v2"]).id, options.expectedResolvedModel);
    assert.equal(readFileSync(fixture.sourceFiles.kilo, "utf8"), fixture.sourceContents.kilo);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }

  const missingAlias = makeDirectories();
  try {
    assert.throws(
      () => readCertifiedProxyConfig({ ...options, kiloModel: "kilo-provider/not-configured" }, missingAlias.dirs),
      /selected model is missing/u,
    );
  } finally {
    rmSync(missingAlias.root, { recursive: true, force: true });
  }

  const unsupported = makeDirectories();
  try {
    const path = join(unsupported.dirs.kilo, "config", "kilo", "kilo.jsonc");
    const kilo = readJsonc(path);
    record(record(kilo.provider)["kilo-provider"]).npm = "other-adapter";
    writeFileSync(path, `${JSON.stringify(kilo)}\n`);
    assert.throws(() => readCertifiedProxyConfig(options, unsupported.dirs), /OpenAI-compatible adapter/u);
  } finally {
    rmSync(unsupported.root, { recursive: true, force: true });
  }
});
