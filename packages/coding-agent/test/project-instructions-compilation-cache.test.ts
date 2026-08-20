import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCachedCompilation,
  loadCachedCompilationFailure,
  persistCompilation,
  persistCompilationFailure,
} from "../src/core/project-instructions/compilation-cache.ts";

const temporaryDirectories: string[] = [];

function createOptions() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "p-project-compilation-cache-"));
  temporaryDirectories.push(temporaryRoot);
  const workspaceRoot = realpathSync(temporaryRoot);
  return {
    cacheDir: join(workspaceRoot, ".pdev", "instructions"),
    workspaceRoot,
    agentsHash: "a".repeat(64),
    compilerVersion: "test-compiler-v1",
    compilerIdentity: "test/model",
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
  it("rejects structurally invalid or malformed successful compiler records", () => {
    const options = createOptions();
    const result = { body: "Use rules/catalog.md.", triggers: { rule: "When rule work applies" } };
    persistCompilation(options, result);
    const cachePath = findCacheFile(options.cacheDir, ".json");

    writeFileSync(cachePath, `${JSON.stringify({ schemaVersion: 1, body: 42, triggers: {} })}\n`);
    expect(loadCachedCompilation(options)).toBeUndefined();

    writeFileSync(cachePath, "not json\n");
    expect(loadCachedCompilation(options)).toBeUndefined();
  });

  it("rejects corrupt failure records and clears a valid backoff after success", () => {
    const options = createOptions();
    persistCompilationFailure(options, { failedAtMs: 123, error: "failure ".repeat(100) });
    const failurePath = findCacheFile(options.cacheDir, ".failure.json");
    expect(loadCachedCompilationFailure(options)).toEqual({
      failedAtMs: 123,
      error: "failure ".repeat(100).slice(0, 500),
    });

    writeFileSync(failurePath, `${JSON.stringify({ schemaVersion: 1, failedAtMs: "now" })}\n`);
    expect(loadCachedCompilationFailure(options)).toBeUndefined();

    persistCompilationFailure(options, { failedAtMs: 456, error: "retry later" });
    persistCompilation(options, { body: "Use rules/catalog.md.", triggers: {} });
    expect(existsSync(failurePath)).toBe(false);
    expect(loadCachedCompilation(options)).toEqual({ body: "Use rules/catalog.md.", triggers: {} });
  });
});
