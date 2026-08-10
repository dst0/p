import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentDir: "",
  options: undefined as unknown,
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}));

vi.mock("../src/config.ts", () => ({
  getAgentDir: () => mocks.agentDir,
}));

vi.mock("../src/core/indexing-daemon.ts", () => ({
  IndexingDaemon: function MockIndexingDaemon(options: unknown) {
    mocks.options = options;
    return { start: mocks.start, stop: mocks.stop };
  },
}));

import { createIndexingDaemonOptions } from "../src/core/indexing-daemon-config.ts";
import { runIndexingService } from "../src/indexing-service-daemon.ts";

let temporaryDirectory: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  mocks.start.mockClear();
  mocks.stop.mockClear();
  mocks.options = undefined;
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

function createAgentDir(): string {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-runtime-"));
  mocks.agentDir = temporaryDirectory;
  fs.writeFileSync(
    path.join(temporaryDirectory, "code-rag.json"),
    `${JSON.stringify({
      qdrantBinary: "/opt/qdrant",
      qdrantDataDirectory: "/var/lib/p-qdrant",
      pythonExecutable: "/opt/p-indexing/bin/python",
      embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
    })}\n`,
  );
  return temporaryDirectory;
}

describe("indexing runtime startup", () => {
  it("builds daemon options from code-rag.json", () => {
    const agentDir = createAgentDir();

    expect(createIndexingDaemonOptions(agentDir)).toEqual({
      agentDir,
      qdrantBinary: "/opt/qdrant",
      qdrantDataDirectory: "/var/lib/p-qdrant",
      pythonExecutable: "/opt/p-indexing/bin/python",
      embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
      embeddingConfigPath: path.join(agentDir, "code-rag.json"),
      useDenseEmbeddings: true,
    });
  });

  it("disables dense embedding startup for fast BM25 mode", () => {
    const agentDir = createAgentDir();
    const configPath = path.join(agentDir, "code-rag.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(configPath, `${JSON.stringify({ ...config, searchMode: "bm25-only" })}\n`);

    expect(createIndexingDaemonOptions(agentDir).useDenseEmbeddings).toBe(false);
  });

  it("passes config-derived options to the daemon", async () => {
    const agentDir = createAgentDir();
    let terminate: (() => void) | undefined;
    vi.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => {
      if (event === "SIGTERM") terminate = listener;
      return process;
    }) as typeof process.once);

    const running = runIndexingService();
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.options).toEqual(createIndexingDaemonOptions(agentDir));
    expect(terminate).toBeDefined();
    terminate?.();
    await running;

    expect(mocks.stop).toHaveBeenCalledWith({ graceful: false });
  });
});
