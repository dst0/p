import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCachedCompilation,
  loadCachedCompilationFailure,
  persistCompilation,
  persistCompilationFailure,
} from "../src/core/project-instructions/compilation-cache.ts";
import { hashText } from "../src/core/project-instructions/content.ts";
import { PROJECT_INSTRUCTION_COMPILER_VERSION } from "../src/core/project-instructions/index.ts";
import { DEFAULT_MODEL_COMPILER_CONTRACT_REVISION } from "../src/core/project-instructions/session-controller.ts";

const temporaryDirectories: string[] = [];

function createOptions(
  compilerVersion = PROJECT_INSTRUCTION_COMPILER_VERSION,
  compilerIdentity = `test/model:${DEFAULT_MODEL_COMPILER_CONTRACT_REVISION}`,
) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "p-project-compilation-cache-"));
  temporaryDirectories.push(temporaryRoot);
  const workspaceRoot = realpathSync(temporaryRoot);
  return {
    cacheDir: join(workspaceRoot, ".pdev", "instructions"),
    workspaceRoot,
    agentsHash: "a".repeat(64),
    compilerVersion,
    compilerIdentity,
  };
}

function findCacheFile(cacheDir: string, suffix: string): string {
  const directory = join(cacheDir, "compilations");
  const name = readdirSync(directory).find((entry) => entry.endsWith(suffix));
  if (!name) throw new Error(`Missing compilation cache file ending in ${suffix}`);
  return join(directory, name);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction compilation cache recovery", () => {
  it("does not reuse success or failure records across compiler schema revisions", () => {
    const oldOptions = createOptions(
      "project-instructions-v4-exact-source-v9-global-provider-context",
      "test/model:exact-source-v7-global-boundaries",
    );
    const result = {
      body: "Always preserve cache evidence.",
      triggers: {},
      classifications: {
        modules: { rule: "always-on" as const },
        constraints: { "constraint-1": "always-on" as const },
      },
      alwaysOn: { "constraint-1": "Always preserve cache evidence." },
      usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, total: 135 },
    };
    persistCompilation(oldOptions, result);
    persistCompilationFailure(oldOptions, { failedAtMs: 123, error: "old schema failure" });
    const currentVersionOptions = { ...oldOptions, compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION };
    const currentContractOptions = {
      ...oldOptions,
      compilerIdentity: `test/model:${DEFAULT_MODEL_COMPILER_CONTRACT_REVISION}`,
    };

    expect(PROJECT_INSTRUCTION_COMPILER_VERSION).not.toBe(oldOptions.compilerVersion);
    expect(DEFAULT_MODEL_COMPILER_CONTRACT_REVISION).not.toBe("exact-source-v7-global-boundaries");
    expect(loadCachedCompilation(currentVersionOptions)).toBeUndefined();
    expect(loadCachedCompilationFailure(currentVersionOptions)).toBeUndefined();
    expect(loadCachedCompilation(currentContractOptions)).toBeUndefined();
    expect(loadCachedCompilationFailure(currentContractOptions)).toBeUndefined();
  });

  it("rejects structurally invalid or malformed successful compiler records", () => {
    const options = createOptions();
    const result = {
      body: "Always preserve cache evidence.",
      triggers: { rule: "When rule work applies" },
      classifications: {
        modules: { rule: "always-on" as const },
        constraints: { "constraint-1": "always-on" as const },
      },
      alwaysOn: { "constraint-1": "Always preserve cache evidence." },
      usage: { input: 20, output: 5, cacheRead: 2, cacheWrite: 1, total: 28 },
    };
    persistCompilation(options, result);
    const cachePath = findCacheFile(options.cacheDir, ".json");

    const current = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
    const stale = {
      schemaVersion: 1,
      agentsHash: current.agentsHash,
      compilerVersion: current.compilerVersion,
      body: current.body,
      triggers: current.triggers,
    };
    writeFileSync(cachePath, `${JSON.stringify({ ...stale, resultHash: hashText(JSON.stringify(stale)) })}\n`);
    expect(loadCachedCompilation(options)).toBeUndefined();

    writeFileSync(cachePath, `${JSON.stringify({ schemaVersion: 2, body: 42, triggers: {} })}\n`);
    expect(loadCachedCompilation(options)).toBeUndefined();

    writeFileSync(cachePath, "not json\n");
    expect(loadCachedCompilation(options)).toBeUndefined();
  });

  it("projects usage before persistence and rejects hash-valid records with unknown usage fields", () => {
    const options = createOptions();
    const privateMarker = "private-provider-payload";
    const result = {
      body: "Always preserve cache evidence.",
      triggers: {},
      classifications: {
        modules: { rule: "always-on" as const },
        constraints: { "constraint-1": "always-on" as const },
      },
      alwaysOn: { "constraint-1": "Always preserve cache evidence." },
      usage: {
        input: 20,
        output: 5,
        cacheRead: 2,
        cacheWrite: 1,
        total: 28,
        rawResponse: privateMarker,
      },
    };
    persistCompilation(options, result);
    const cachePath = findCacheFile(options.cacheDir, ".json");
    const persistedText = readFileSync(cachePath, "utf8");
    expect(persistedText).not.toContain(privateMarker);
    expect(loadCachedCompilation(options)?.usage).toEqual({
      input: 20,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      total: 28,
    });

    const contaminated = JSON.parse(persistedText) as Record<string, unknown>;
    contaminated.usage = {
      ...(contaminated.usage as Record<string, unknown>),
      rawResponse: privateMarker,
    };
    const { resultHash: _resultHash, ...hashInput } = contaminated;
    contaminated.resultHash = hashText(JSON.stringify(hashInput));
    writeFileSync(cachePath, `${JSON.stringify(contaminated)}\n`);
    expect(loadCachedCompilation(options)).toBeUndefined();
  });

  it("rejects corrupt failure records and clears a valid backoff after success", () => {
    const options = createOptions();
    persistCompilationFailure(options, { failedAtMs: 123, error: "failure ".repeat(100) });
    const failurePath = findCacheFile(options.cacheDir, ".failure.json");
    expect(loadCachedCompilationFailure(options)).toEqual({
      failedAtMs: 123,
      error: "Error: Instruction compiler failed",
    });

    writeFileSync(failurePath, `${JSON.stringify({ schemaVersion: 1, failedAtMs: "now" })}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();

    persistCompilationFailure(options, { failedAtMs: 456, error: "retry later" });
    const result = {
      body: "Always preserve cache evidence.",
      triggers: {},
      classifications: {
        modules: { rule: "always-on" as const },
        constraints: { "constraint-1": "always-on" as const },
      },
      alwaysOn: { "constraint-1": "Always preserve cache evidence." },
      usage: { input: 30, output: 6, cacheRead: 3, cacheWrite: 2, total: 41 },
    };
    persistCompilation(options, result);
    expect(existsSync(failurePath)).toBe(false);
    expect(loadCachedCompilation(options)).toEqual(result);
  });
});
