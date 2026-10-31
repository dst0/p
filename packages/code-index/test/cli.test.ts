import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BM25Vocabulary } from "../src/bm25.ts";
import { main, parseArgs, printUsage } from "../src/cli.ts";
import { CodeIndexer } from "../src/indexer.ts";
import { QdrantClient } from "../src/qdrant.ts";

/**
 * Thrown by the mocked `process.exit`. A real exit never returns, so the mock must stop execution too: a no-op mock
 * lets the code under test keep running past the exit and keep logging after the test (and its spies) are gone.
 */
class ExitCalled extends Error {
  readonly exitCode: string | number | null | undefined;

  constructor(exitCode: string | number | null | undefined) {
    super(`process.exit(${exitCode})`);
    this.name = "ExitCalled";
    this.exitCode = exitCode;
  }
}

async function expectExit(run: Promise<unknown>, exitCode: number): Promise<void> {
  const error = await run.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ExitCalled);
  expect(error).toMatchObject({ exitCode });
}

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let removeAddedProcessListeners: () => void;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((exitCode?: string | number | null) => {
    throw new ExitCalled(exitCode);
  }) as never);

  // `main` registers real SIGINT/SIGTERM/exit handlers on the worker process; drop the ones a test added.
  const sigint = new Set(process.listeners("SIGINT"));
  const sigterm = new Set(process.listeners("SIGTERM"));
  const exit = new Set(process.listeners("exit"));
  removeAddedProcessListeners = () => {
    for (const listener of process.listeners("SIGINT")) if (!sigint.has(listener)) process.off("SIGINT", listener);
    for (const listener of process.listeners("SIGTERM")) if (!sigterm.has(listener)) process.off("SIGTERM", listener);
    for (const listener of process.listeners("exit")) if (!exit.has(listener)) process.off("exit", listener);
  };
});

afterEach(() => {
  removeAddedProcessListeners();
  vi.restoreAllMocks();
});

describe("cli parseArgs", () => {
  it("parses all options correctly", () => {
    const argv = [
      "node",
      "cli.js",
      "--repo",
      "my-repo",
      "--status",
      "--delete-repo",
      "old-repo",
      "--search",
      "find me",
      "--workspace",
      "/my/workspace",
      "--batch-size",
      "32",
      "--limit",
      "15",
      "--embedding-server",
      "http://localhost:9999",
    ];

    const args = parseArgs(argv);
    expect(args).toEqual({
      repo: "my-repo",
      status: true,
      deleteRepo: "old-repo",
      search: "find me",
      workspace: "/my/workspace",
      batchSize: 32,
      limit: 15,
      embeddingServerUrl: "http://localhost:9999",
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.each(["--help", "-h"])("prints usage and exits 0 on %s", (flag) => {
    expect(() => parseArgs(["node", "cli.js", flag])).toThrow(new ExitCalled(0));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("code-index — hybrid dense + BM25 code indexer"));
    expect(exitSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("reports an unknown option, prints usage and exits 1 without parsing further", () => {
    expect(() => parseArgs(["node", "cli.js", "--invalid", "--repo", "never-parsed"])).toThrow(new ExitCalled(1));

    expect(errSpy).toHaveBeenCalledWith("Unknown option: --invalid");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(exitSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("cli main", () => {
  beforeEach(() => {
    vi.spyOn(CodeIndexer.prototype, "getStatus").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "deleteRepo").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "load").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "loadVocab").mockResolvedValue(true);
    vi.spyOn(CodeIndexer.prototype, "search").mockResolvedValue([]);
    vi.spyOn(CodeIndexer.prototype, "searchDense").mockResolvedValue([]);
    vi.spyOn(CodeIndexer.prototype, "indexRepo").mockResolvedValue({ files: 5, chunks: 10, skipped: 1, errors: 0 });
    vi.spyOn(QdrantClient.prototype, "createCollection").mockResolvedValue(undefined);
    vi.spyOn(QdrantClient.prototype, "getStatus").mockResolvedValue({
      points: 10,
      indexedVectors: 10,
      segments: 1,
      vectorDim: 1024,
      sparseVectors: true,
    });
    vi.spyOn(BM25Vocabulary.prototype, "save").mockImplementation(() => {});
  });

  it("runs --status without loading the model", async () => {
    await main(["node", "cli.js", "--status"]);

    expect(CodeIndexer.prototype.getStatus).toHaveBeenCalledOnce();
    expect(CodeIndexer.prototype.load).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("runs --delete-repo without loading the model", async () => {
    await main(["node", "cli.js", "--delete-repo", "repo1"]);

    expect(CodeIndexer.prototype.deleteRepo).toHaveBeenCalledWith("repo1");
    expect(CodeIndexer.prototype.load).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("runs --search with vocab available", async () => {
    await main(["node", "cli.js", "--search", "test query", "--limit", "5"]);

    expect(CodeIndexer.prototype.search).toHaveBeenCalledWith("test query", 5);
    expect(CodeIndexer.prototype.searchDense).not.toHaveBeenCalled();
  });

  it("runs --search without vocab (dense-only fallback)", async () => {
    vi.spyOn(CodeIndexer.prototype, "loadVocab").mockResolvedValueOnce(false);

    await main(["node", "cli.js", "--search", "test query"]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("BM25 vocabulary not found"));
    expect(CodeIndexer.prototype.searchDense).toHaveBeenCalledWith("test query", undefined);
    expect(CodeIndexer.prototype.search).not.toHaveBeenCalled();
  });

  it("runs --repo with absolute path", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-cli-test-"));
    try {
      await main(["node", "cli.js", "--repo", tmpDir]);

      expect(CodeIndexer.prototype.indexRepo).toHaveBeenCalledWith(tmpDir);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("stops at the exit when a relative repo does not exist in the workspace", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p-cli-empty-workspace-"));
    try {
      await expectExit(main(["node", "cli.js", "--repo", "non-existent-repo-12345", "--workspace", workspace]), 1);

      expect(errSpy).toHaveBeenCalledWith("❌ Repo not found: non-existent-repo-12345");
      expect(exitSpy).toHaveBeenCalledOnce();
      expect(CodeIndexer.prototype.getStatus).not.toHaveBeenCalled();
      expect(CodeIndexer.prototype.indexRepo).not.toHaveBeenCalled();
      expect(QdrantClient.prototype.createCollection).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("runs full workspace reindex", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-cli-workspace-"));
    const repo1 = path.join(tmpDir, "repo1");
    fs.mkdirSync(path.join(repo1, ".git"), { recursive: true });

    try {
      await main(["node", "cli.js", "--workspace", tmpDir]);

      expect(QdrantClient.prototype.createCollection).toHaveBeenCalledOnce();
      expect(CodeIndexer.prototype.indexRepo).toHaveBeenCalledOnce();
      expect(CodeIndexer.prototype.indexRepo).toHaveBeenCalledWith(repo1);
      expect(BM25Vocabulary.prototype.save).toHaveBeenCalledOnce();
      expect(QdrantClient.prototype.getStatus).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Index complete"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Total: 5 files, 10 chunks"));
      expect(logSpy).toHaveBeenCalledWith("   Qdrant points: 10");
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prints usage correctly", () => {
    printUsage();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("code-index — hybrid dense + BM25 code indexer"));
  });
});
