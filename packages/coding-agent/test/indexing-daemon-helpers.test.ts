import { describe, expect, it } from "vitest";
import { isIgnoredWatchPath } from "../src/core/indexing-daemon/helpers.ts";
import { IndexingDaemon } from "../src/core/indexing-daemon/indexingdaemon.ts";

describe("indexing daemon path filtering", () => {
  it.each([
    ".git",
    "src/node_modules/package/index.ts",
    "src\\node_modules\\package\\index.ts",
    "/workspace/coverage/report.json",
    "build/output.js",
    "nested/.venv/bin/python",
  ])("ignores a configured path segment in %s", (filename) => {
    expect(isIgnoredWatchPath(filename)).toBe(true);
  });

  it.each([
    ".github/workflows/ci.yml",
    "src/node_modules-cache/index.ts",
    "src/distilled/index.ts",
    "targeted/file.ts",
    "storage-adapter/index.ts",
  ])("does not ignore a partial segment match in %s", (filename) => {
    expect(isIgnoredWatchPath(filename)).toBe(false);
  });

  it("exercises default releaseEmbeddingDevice behavior with and without dense embeddings", async () => {
    const dummyOptions = {
      agentDir: "/tmp/fake-agent",
      qdrantBinary: "unused",
      qdrantDataDirectory: "/tmp/fake-agent/qdrant",
      pythonExecutable: "unused",
      embeddingModel: "unused",
    };
    const denseDisabled = new IndexingDaemon({
      ...dummyOptions,
      useDenseEmbeddings: false,
    });
    await expect(denseDisabled.releaseEmbeddingDevice()).resolves.toBeUndefined();

    const denseEnabled = new IndexingDaemon({
      ...dummyOptions,
      useDenseEmbeddings: true,
    });
    let stopped = false;
    let waited = false;
    Reflect.set(denseEnabled, "embeddingManager", {
      waitUntilIdle: async () => {
        waited = true;
      },
      stop: async () => {
        stopped = true;
      },
    });
    await denseEnabled.releaseEmbeddingDevice();
    expect(waited).toBe(true);
    expect(stopped).toBe(true);
  });
});
