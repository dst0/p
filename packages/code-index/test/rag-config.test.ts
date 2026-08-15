import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("loads embedding runtime settings from the config file", () => {
    const dir = createTempDir();
    const configPath = path.join(dir, "code-rag.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        amdIronArtifactDirectory: "/managed/artifacts",
        amdIronCacheDirectory: "/managed/cache",
        amdIronSourceDirectory: "/managed/mlir-aie",
        amdNpuGeneration: "npu1",
        amdNpuRuntimeVersion: "1.4.0",
        embeddingDevice: "amd-phoenix-npu",
        searchMode: "bm25-only",
        maxEmbeddingBatchSize: 12,
        torchBackend: "cpu",
      }),
    );

    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      userConfigPath: configPath,
    });
    expect(settings.embeddingDevice).toBe("amd-phoenix-npu");
    expect(settings.searchMode).toBe("bm25-only");
    expect(settings.amdIronArtifactDirectory).toBe("/managed/artifacts");
    expect(settings.amdNpuGeneration).toBe("npu1");
    expect(settings.maxEmbeddingBatchSize).toBe(12);
    expect(settings.mpsPrecision).toBe("bfloat16");
    expect(settings.maxSequenceLength).toBe(2048);
    expect(settings.torchBackend).toBe("cpu");
  });

  it("bounds the sequence default only for Apple accelerators", () => {
    const dir = createTempDir();
    const mps = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      settings: { embeddingDevice: "mps", maxSequenceLength: 1024 },
    });
    const cuda = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      settings: { embeddingDevice: "cuda" },
    });

    expect(mps.maxSequenceLength).toBe(512);
    expect(cuda.maxSequenceLength).toBe(2048);
  });

  it("rejects unsupported embedding runtime settings", () => {
    const dir = createTempDir();
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { embeddingDevice: "invalid" as "cpu" },
      }),
    ).toThrow("embeddingDevice is unsupported");
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { torchBackend: "invalid" as "cpu" },
      }),
    ).toThrow("torchBackend is unsupported");
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { mpsPrecision: "invalid" as "bfloat16" },
      }),
    ).toThrow("mpsPrecision is unsupported");
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { searchMode: "invalid" as "hybrid" },
      }),
    ).toThrow("searchMode is unsupported");
    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { embeddingModelParameterCount: 0 },
      }),
    ).toThrow("embeddingModelParameterCount must be a positive integer");
  });

  it("loads file preparation resource settings from config", () => {
    const dir = createTempDir();
    const configPath = path.join(dir, "code-rag.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        preparationMaxWorkers: 12,
        preparationWorkerMemoryBytes: 96 * 1024 * 1024,
        preparationMemoryReserveBytes: 768 * 1024 * 1024,
      }),
    );
    const settings = loadWorkspaceCodeRagSettings({
      dataDirectory: dir,
      workspaceRoot: dir,
      userConfigPath: configPath,
    });
    expect(settings.preparationMaxWorkers).toBe(12);
    expect(settings.preparationWorkerMemoryBytes).toBe(96 * 1024 * 1024);
    expect(settings.preparationMemoryReserveBytes).toBe(768 * 1024 * 1024);
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

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { preparationMaxWorkers: 1.5 },
      }),
    ).toThrow("preparationMaxWorkers must be a positive integer");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { preparationWorkerMemoryBytes: 1024 },
      }),
    ).toThrow("preparationWorkerMemoryBytes must be an integer of at least 1 MiB");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { preparationMemoryReserveBytes: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow("preparationMemoryReserveBytes must be a positive integer");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { maxFileBytes: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow("maxFileBytes must be a positive integer");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { maxSparseVocabularyTokens: 1.5 },
      }),
    ).toThrow("maxSparseVocabularyTokens must be a positive integer");
  });

  it("validates remote URLs when remoteBackendsAllowed is false", () => {
    const dir = createTempDir();

    expect(() =>
      loadWorkspaceCodeRagSettings({ dataDirectory: dir, workspaceRoot: dir, settings: { qdrantUrl: "invalid-url" } }),
    ).toThrow("must be a valid absolute URL");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { qdrantUrl: "http://qdrant.remote.com:6333", remoteBackendsAllowed: false },
      }),
    ).toThrow("must be local unless remoteBackendsAllowed");

    expect(() =>
      loadWorkspaceCodeRagSettings({
        dataDirectory: dir,
        workspaceRoot: dir,
        settings: { qdrantUrl: "ftp://127.0.0.1:6333", remoteBackendsAllowed: false },
      }),
    ).toThrow("must be a valid absolute URL");
  });
});
