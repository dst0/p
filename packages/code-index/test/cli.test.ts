import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs, printUsage } from "../src/cli.ts";
import { CodeIndexer } from "../src/indexer.ts";

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
  });

  it("handles --help flag", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    parseArgs(["node", "cli.js", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("handles unknown option", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    parseArgs(["node", "cli.js", "--invalid"]);

    expect(errSpy).toHaveBeenCalledWith("Unknown option: --invalid");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("cli main", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    vi.spyOn(CodeIndexer.prototype, "getStatus").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "deleteRepo").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "load").mockResolvedValue(undefined);
    vi.spyOn(CodeIndexer.prototype, "loadVocab").mockResolvedValue(true);
    vi.spyOn(CodeIndexer.prototype, "search").mockResolvedValue([]);
    vi.spyOn(CodeIndexer.prototype, "searchDense").mockResolvedValue([]);
    vi.spyOn(CodeIndexer.prototype, "indexRepo").mockResolvedValue({ files: 5, chunks: 10, skipped: 1, errors: 0 });
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("runs --status", async () => {
    await main(["node", "cli.js", "--status"]);
    expect(CodeIndexer.prototype.getStatus).toHaveBeenCalled();
  });

  it("runs --delete-repo", async () => {
    await main(["node", "cli.js", "--delete-repo", "repo1"]);
    expect(CodeIndexer.prototype.deleteRepo).toHaveBeenCalledWith("repo1");
  });

  it("runs --search with vocab available", async () => {
    await main(["node", "cli.js", "--search", "test query", "--limit", "5"]);
    expect(CodeIndexer.prototype.search).toHaveBeenCalledWith("test query", 5);
  });

  it("runs --search without vocab (dense-only fallback)", async () => {
    vi.spyOn(CodeIndexer.prototype, "loadVocab").mockResolvedValueOnce(false);

    await main(["node", "cli.js", "--search", "test query"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("BM25 vocabulary not found"));
    expect(CodeIndexer.prototype.searchDense).toHaveBeenCalledWith("test query", undefined);
  });

  it("runs --repo with absolute path", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-cli-test-"));
    try {
      await main(["node", "cli.js", "--repo", tmpDir]);
      expect(CodeIndexer.prototype.indexRepo).toHaveBeenCalledWith(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles non-existent relative repo error", async () => {
    await main(["node", "cli.js", "--repo", "non-existent-repo-12345", "--workspace", "/tmp"]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Repo not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("runs full workspace reindex", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-cli-workspace-"));
    const repo1 = path.join(tmpDir, "repo1");
    fs.mkdirSync(path.join(repo1, ".git"), { recursive: true });

    try {
      await main(["node", "cli.js", "--workspace", tmpDir]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Index complete"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prints usage correctly", () => {
    printUsage();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("code-index — hybrid dense + BM25 code indexer"));
  });
});
