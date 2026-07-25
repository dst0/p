import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";

const temporaryDirectories: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-config-test-"));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadWorkspaceCodeRagSettings edge cases", () => {
  let envSave: NodeJS.ProcessEnv;

  beforeEach(() => {
    envSave = { ...process.env };
  });

  afterEach(() => {
    process.env = envSave;
  });

  it("throws on invalid JSON in config file", () => {
    const dir = createTempDir();
    const configPath = path.join(dir, "invalid.json");
    fs.writeFileSync(configPath, "{ invalid json");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        userConfigPath: configPath,
      }),
    ).toThrow("Invalid code RAG config");
  });

  it("throws on non-object JSON value in config file", () => {
    const dir = createTempDir();
    const configPath = path.join(dir, "array.json");
    fs.writeFileSync(configPath, "[1, 2, 3]");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        userConfigPath: configPath,
      }),
    ).toThrow("expected a JSON object");
  });

  it("validates types in config file fields", () => {
    const dir = createTempDir();

    // boolean expected
    const cfg1 = path.join(dir, "cfg1.json");
    fs.writeFileSync(cfg1, JSON.stringify({ enabled: "not a boolean" }));
    expect(() =>
      loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir, userConfigPath: cfg1 }),
    ).toThrow("expected boolean");

    // number expected
    const cfg2 = path.join(dir, "cfg2.json");
    fs.writeFileSync(cfg2, JSON.stringify({ defaultLimit: "not a number" }));
    expect(() =>
      loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir, userConfigPath: cfg2 }),
    ).toThrow("expected finite number");

    // non-empty string expected
    const cfg3 = path.join(dir, "cfg3.json");
    fs.writeFileSync(cfg3, JSON.stringify({ qdrantUrl: "" }));
    expect(() =>
      loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir, userConfigPath: cfg3 }),
    ).toThrow("expected non-empty string");

    // unknown field
    const cfg4 = path.join(dir, "cfg4.json");
    fs.writeFileSync(cfg4, JSON.stringify({ unknownField123: 123 }));
    expect(() =>
      loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir, userConfigPath: cfg4 }),
    ).toThrow("Unknown code RAG config field");
  });

  it("validates boolean environment variables", () => {
    const dir = createTempDir();

    // Valid boolean env vars
    process.env.P_CODE_RAG_ENABLED = "1";
    process.env.P_CODE_RAG_AUTO_REFRESH = "true";
    process.env.P_CODE_RAG_REMOTE_BACKENDS_ALLOWED = "0";

    const settings = loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir });
    expect(settings.enabled).toBe(true);
    expect(settings.autoRefresh).toBe(true);
    expect(settings.remoteBackendsAllowed).toBe(false);

    // Invalid boolean env var
    process.env.P_CODE_RAG_ENABLED = "maybe";
    expect(() => loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir })).toThrow(
      "must be true, false, 1, or 0",
    );
  });

  it("validates result limits, dimensions, and rebuild ratios", () => {
    const dir = createTempDir();

    // Invalid limit
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { defaultLimit: 0 },
      }),
    ).toThrow("result limits are invalid");

    // Invalid embeddingDimensions
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { embeddingDimensions: -1 },
      }),
    ).toThrow("must be a positive integer");

    // Invalid fullSparseRebuildChangeRatio
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { fullSparseRebuildChangeRatio: 1.5 },
      }),
    ).toThrow("fullSparseRebuildChangeRatio must be between 0 and 1");

    // Invalid sparseRebuildDriftRatio
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { sparseRebuildDriftRatio: -0.1 },
      }),
    ).toThrow("sparseRebuildDriftRatio must be between 0 and 1");
  });

  it("validates remote URLs when remoteBackendsAllowed is false", () => {
    const dir = createTempDir();

    // Invalid URL string
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { qdrantUrl: "invalid-url" },
      }),
    ).toThrow("must be a valid absolute URL");

    // Remote non-local URL when remoteBackendsAllowed = false
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { qdrantUrl: "http://qdrant.remote.com:6333", remoteBackendsAllowed: false },
      }),
    ).toThrow("must be local unless remoteBackendsAllowed");

    // Non-http protocol
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { qdrantUrl: "ftp://127.0.0.1:6333", remoteBackendsAllowed: false },
      }),
    ).toThrow("must be a valid absolute URL");
  });
});
