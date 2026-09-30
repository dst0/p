import assert from "node:assert/strict";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readCertifiedProxyConfig, rewriteCertifiedAgentConfigs } from "../../src/harness/certified-proxy-config.ts";
import {
  apiKeyValues,
  makeDirectories,
  nestedPropertyValues,
  options,
  readJsonc,
  record,
} from "./certified-proxy-config-fixtures.ts";

test("certified config matches the model id, scrubs copied secrets, and rewrites only private routes", () => {
  const fixture = makeDirectories();
  try {
    const config = readCertifiedProxyConfig(options, fixture.dirs);
    assert.equal(config.upstreamBaseUrl, "https://upstream.invalid/v1");
    assert.equal(config.resolvedModel, options.expectedResolvedModel);
    assert.equal(config.expectedModel, options.expectedResolvedModel);
    assert.equal(config.apiKey, "canonical-test-key");

    rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1");

    for (const agent of ["p", "pi"]) {
      const models = JSON.parse(readFileSync(join(fixture.dirs[agent], "models.json"), "utf8")) as {
        providers: { compiler: { baseUrl: string; models: Array<Record<string, unknown>> } };
      };
      assert.equal(models.providers.compiler.baseUrl, "http://localhost:43210/v1");
      assert.deepEqual(models.providers.compiler.models, [
        {
          id: options.expectedResolvedModel,
          name: "Certified benchmark model",
          reasoning: true,
          contextWindow: 8192,
          maxTokens: 4096,
          input: ["text"],
          compat: { thinkingFormat: "qwen" },
        },
      ]);
      assert.deepEqual(apiKeyValues(models), ["benchmark-proxy"]);
      assert.deepEqual(nestedPropertyValues(models, "headers"), []);
    }
    const kiloPath = join(fixture.dirs.kilo, "config", "kilo", "kilo.jsonc");
    const kilo = readJsonc(kiloPath);
    const provider = record(record(kilo.provider)["kilo-provider"]);
    const providerOptions = record(provider.options);
    const model = record(record(provider.models)["alias-v2"]);
    assert.equal(providerOptions.baseURL, "http://localhost:43210/v1");
    assert.equal(providerOptions.apiKey, "benchmark-proxy");
    assert.equal(providerOptions.timeout, false);
    assert.equal(providerOptions.chunkTimeout, 120000);
    assert.equal(model.id, options.expectedResolvedModel);
    assert.equal(model.reasoning, true);
    assert.equal(model.tool_call, true);
    assert.equal(model.temperature, true);
    assert.deepEqual(model.limit, { context: 8192, output: 4096 });
    assert.deepEqual(model.modalities, { input: ["text"], output: ["text"] });
    assert.deepEqual(apiKeyValues(kilo), ["benchmark-proxy"]);
    assert.deepEqual(nestedPropertyValues(kilo, "headers"), []);
    assert.doesNotMatch(readFileSync(kiloPath, "utf8"), /Kept while/u);
    for (const key of ["p", "pi", "kilo"] as const) {
      assert.equal(readFileSync(fixture.sourceFiles[key], "utf8"), fixture.sourceContents[key]);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("certified private configs omit comments, unknown fields, and unused providers", () => {
  const fixture = makeDirectories();
  const sentinels = ["COMMENT_SENTINEL_9f81", "UNKNOWN_SENTINEL_6a22", "UNUSED_SENTINEL_2b73"];
  try {
    for (const agent of ["p", "pi"] as const) {
      const sourcePath = fixture.sourceFiles[agent];
      const source = JSON.parse(readFileSync(sourcePath, "utf8")) as {
        providers: Record<string, Record<string, unknown>>;
      };
      source.providers.compiler.privateOptions = { token: sentinels[1] };
      source.providers.unused.privateOptions = { token: sentinels[2] };
      const text = `${JSON.stringify(source)}\n`;
      writeFileSync(sourcePath, text);
      fixture.sourceContents[agent] = text;
      copyFileSync(sourcePath, join(fixture.dirs[agent], "models.json"));
    }

    const kiloPath = fixture.sourceFiles.kilo;
    const sourceKilo = readJsonc(kiloPath);
    const provider = record(record(sourceKilo.provider)["kilo-provider"]);
    record(provider.options).privateOptions = { token: sentinels[1] };
    record(sourceKilo.provider)["unused-provider"] = { privateOptions: { token: sentinels[2] } };
    const kiloText = `// ${sentinels[0]}\n${JSON.stringify(sourceKilo, null, 2)}\n`;
    writeFileSync(kiloPath, kiloText);
    fixture.sourceContents.kilo = kiloText;
    const privateKiloPath = join(fixture.dirs.kilo, "config", "kilo", "kilo.jsonc");
    copyFileSync(kiloPath, privateKiloPath);

    rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1");

    for (const agent of ["p", "pi"] as const) {
      const text = readFileSync(join(fixture.dirs[agent], "models.json"), "utf8");
      for (const sentinel of sentinels) assert.equal(text.includes(sentinel), false);
      assert.deepEqual(Object.keys(record(record(JSON.parse(text)).providers)), ["compiler"]);
      assert.equal(readFileSync(fixture.sourceFiles[agent], "utf8"), fixture.sourceContents[agent]);
    }
    const rewrittenKilo = readFileSync(privateKiloPath, "utf8");
    for (const sentinel of sentinels) assert.equal(rewrittenKilo.includes(sentinel), false);
    assert.deepEqual(Object.keys(record(readJsonc(privateKiloPath).provider)), ["kilo-provider"]);
    assert.equal(readFileSync(kiloPath, "utf8"), fixture.sourceContents.kilo);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("P and Pi reject divergent selected generation metadata before candidate execution", () => {
  const fixture = makeDirectories();
  try {
    const path = join(fixture.dirs.pi, "models.json");
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      providers: { compiler: { models: Array<Record<string, unknown>> } };
    };
    config.providers.compiler.models[0]!.maxTokens = 1024;
    writeFileSync(path, `${JSON.stringify(config)}\n`);
    assert.throws(() => readCertifiedProxyConfig(options, fixture.dirs), /generation metadata mismatch/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
