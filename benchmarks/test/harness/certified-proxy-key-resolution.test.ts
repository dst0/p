import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCertifiedProxyConfig, rewriteCertifiedAgentConfigs } from "../../src/harness/certified-proxy-config.ts";

const options = {
  model: "surface/model",
  kiloModel: "kilo/alias",
  expectedResolvedModel: "model",
};

function sourceConfigs(apiKey: string): { root: string; dirs: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), "certified-proxy-key-resolution-"));
  const dirs = {
    p: join(root, "p"),
    pi: join(root, "pi"),
    kilo: join(root, "kilo"),
  };
  try {
    for (const agent of ["p", "pi"] as const) {
      mkdirSync(dirs[agent]);
      writeFileSync(
        join(dirs[agent], "models.json"),
        JSON.stringify({
          providers: {
            surface: {
              api: "openai-completions",
              baseUrl: "https://upstream.invalid/v1",
              apiKey,
              models: [{ id: "model", name: "model" }],
            },
          },
        }),
      );
    }
    const kiloDir = join(dirs.kilo, "config", "kilo");
    mkdirSync(kiloDir, { recursive: true });
    writeFileSync(
      join(kiloDir, "kilo.jsonc"),
      JSON.stringify({
        model: "kilo/alias",
        provider: {
          kilo: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "http://legacy.invalid/v1" },
            models: { alias: { id: "legacy-model" } },
          },
        },
      }),
    );
    return { root, dirs };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("certified parent proxy resolves environment-backed canonical API key", () => {
  const name = `P_CERTIFIED_PROXY_TEST_KEY_${randomUUID().replaceAll("-", "").toUpperCase()}`;
  const fixture = sourceConfigs(`$${name}`);
  process.env[name] = "test-resolved-key";
  try {
    assert.equal(readCertifiedProxyConfig(options, fixture.dirs).apiKey, "test-resolved-key");
    rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1");
    for (const path of [
      join(fixture.dirs.p, "models.json"),
      join(fixture.dirs.pi, "models.json"),
      join(fixture.dirs.kilo, "config", "kilo", "kilo.jsonc"),
    ]) {
      const copiedConfig = readFileSync(path, "utf8");
      assert.equal(copiedConfig.includes("test-resolved-key"), false);
      assert.equal(copiedConfig.includes(name), false);
      assert.match(copiedConfig, /benchmark-proxy/u);
    }
  } finally {
    delete process.env[name];
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test(
  "certified parent proxy resolves command-backed canonical API key once",
  { skip: process.platform === "win32" },
  () => {
    const markerRoot = mkdtempSync(join(tmpdir(), "certified-proxy-key-command-"));
    const marker = join(markerRoot, "calls");
    const markerName = `P_CERTIFIED_PROXY_MARKER_${randomUUID().replaceAll("-", "").toUpperCase()}`;
    process.env[markerName] = marker;
    let fixture: ReturnType<typeof sourceConfigs> | undefined;
    try {
      fixture = sourceConfigs(`!printf x >> "$${markerName}"; printf test-command-key`);
      assert.equal(readCertifiedProxyConfig(options, fixture.dirs).apiKey, "test-command-key");
      rewriteCertifiedAgentConfigs(options, fixture.dirs, "http://localhost:43210/v1");
      assert.equal(readFileSync(marker, "utf8"), "x");
    } finally {
      if (fixture) rmSync(fixture.root, { recursive: true, force: true });
      delete process.env[markerName];
      rmSync(markerRoot, { recursive: true, force: true });
    }
  },
);

test("certified parent proxy rejects unresolved API keys without disclosing expressions", () => {
  const missingName = `P_CERTIFIED_PROXY_MISSING_${randomUUID().replaceAll("-", "").toUpperCase()}`;
  const emptyName = `P_CERTIFIED_PROXY_EMPTY_${randomUUID().replaceAll("-", "").toUpperCase()}`;
  process.env[emptyName] = "";
  try {
    for (const expression of [
      `$${missingName}`,
      `$${emptyName}`,
      ...(process.platform === "win32" ? [] : ["!false", "!printf '   '"]),
    ]) {
      const fixture = sourceConfigs(expression);
      try {
        assert.throws(
          () => readCertifiedProxyConfig(options, fixture.dirs),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /canonical API key.*resolve/u);
            assert.equal(error.message.includes(expression), false);
            return true;
          },
        );
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  } finally {
    delete process.env[emptyName];
  }
});
