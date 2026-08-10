import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfiguredIndexingBatchSize, getConfiguredIndexingDevice } from "../src/core/indexing-service.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("configured indexing status", () => {
  it("reads the current code-rag.json settings", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-config-status-"));
    temporaryDirectories.push(agentDir);
    fs.writeFileSync(
      path.join(agentDir, "code-rag.json"),
      JSON.stringify({ embeddingDevice: "mps", maxEmbeddingBatchSize: 4 }),
    );

    expect(getConfiguredIndexingDevice(agentDir)).toBe("mps");
    expect(getConfiguredIndexingBatchSize(agentDir)).toBe(4);
  });

  it("ignores malformed or invalid settings", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-index-config-status-"));
    temporaryDirectories.push(agentDir);
    fs.writeFileSync(
      path.join(agentDir, "code-rag.json"),
      JSON.stringify({ embeddingDevice: "", maxEmbeddingBatchSize: 0 }),
    );

    expect(getConfiguredIndexingDevice(agentDir)).toBeUndefined();
    expect(getConfiguredIndexingBatchSize(agentDir)).toBeUndefined();
  });
});
