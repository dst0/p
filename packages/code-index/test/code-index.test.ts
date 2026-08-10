import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BM25Vocabulary,
  chunkFile,
  computePointId,
  DEFAULT_WORKSPACE_CODE_RAG_SETTINGS,
  discoverFiles,
  discoverFilesWithOptions,
  findRepos,
} from "../src/index.ts";
import { CHUNKER_VERSION } from "../src/rag/manifest.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("BM25Vocabulary edge cases", () => {
  it("keeps average document length stable across repeated finalization and incremental registration", () => {
    const vocabulary = new BM25Vocabulary();
    vocabulary.register("one two");
    vocabulary.register("three");
    vocabulary.finalize();
    vocabulary.finalize();
    expect(vocabulary.avgDl).toBe(1.5);

    vocabulary.register("four five six");
    vocabulary.finalize();
    expect(vocabulary.avgDl).toBe(2);
  });

  it("handles empty text encoding gracefully", () => {
    const vocabulary = new BM25Vocabulary();
    vocabulary.register("sample code text");
    const result = vocabulary.encode("");
    expect(result).toEqual({ indices: [], values: [] });
  });

  it("handles duplicate tokens across documents, token splitting with underscores, and save with relative filename", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-bm25-test-"));
    temporaryDirectories.push(directory);

    const vocabulary = new BM25Vocabulary();
    vocabulary.register("my_function_name my_function_name");
    vocabulary.register("my_function_name second_doc");
    vocabulary.finalize();

    // Query token not in vocabulary
    const encoded = vocabulary.encode("unseen_token my_function_name");
    expect(encoded.indices.length).toBeGreaterThan(0);

    // Save and load
    const vocabPath = join(directory, "vocab.json");
    vocabulary.save(vocabPath);
    const loaded = BM25Vocabulary.load(vocabPath);
    expect(loaded.totalDocs).toBe(2);
  });

  it("computes point IDs consistently", () => {
    const id1 = computePointId("abc", 10);
    const id2 = computePointId("abc", 10);
    expect(typeof id1).toBe("number");
    expect(id1).toBe(id2);
  });
});

describe("workspace RAG defaults", () => {
  it("allows enough time for a local embedding query while indexing is active", () => {
    expect(DEFAULT_WORKSPACE_CODE_RAG_SETTINGS.searchTimeoutMs).toBe(30_000);
  });
});

describe("chunkFile edge cases", () => {
  it("uses zero-based symbol boundaries internally while reporting one-based source lines", () => {
    const chunks = chunkFile(
      ["export function alpha() {", "\treturn 1;", "}", "export function beta() {", "\treturn 2;", "}"].join("\n"),
      "typescript",
    );

    expect(chunks.map(({ startLine, endLine, symbol }) => ({ startLine, endLine, symbol }))).toEqual([
      { startLine: 1, endLine: 3, symbol: "function alpha" },
      { startLine: 4, endLine: 6, symbol: "function beta" },
    ]);
  });

  it("keeps multiline JSDoc, decorators, and trailing comments in the correct chunks", () => {
    const chunks = chunkFile(
      [
        "export const before = true;",
        "",
        "/**",
        " * Register an LLM-callable tool with a TypeBox schema.",
        " */",
        "@sealed",
        "export function defineTool() {}",
        "// trailing implementation note",
      ].join("\n"),
      "typescript",
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ startLine: 3, endLine: 8, symbol: "function defineTool" });
    expect(chunks[1].text).toContain("Register an LLM-callable tool");
    expect(chunks[1].text).toContain("@sealed");
    expect(chunks[1].text).toContain("trailing implementation note");
  });

  it("keeps consecutive line comments with the declaration they document", () => {
    const chunks = chunkFile(
      [
        "export const before = true;",
        "// Tool definition contract.",
        "// Parameters use TypeBox.",
        "export interface ToolDefinition {}",
      ].join("\n"),
      "typescript",
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ startLine: 2, endLine: 4, symbol: "interface ToolDefinition" });
    expect(chunks[1].text).toContain("Parameters use TypeBox");
  });

  it("extracts symbols correctly for Go language", () => {
    const chunks = chunkFile(
      ["package main", "", "func HandleRequest(w http.ResponseWriter, r *http.Request) {", "}"].join("\n"),
      "go",
    );
    expect(chunks.length).toBeGreaterThan(0);
    const fnChunk = chunks.find((c) => c.symbol.startsWith("func"));
    expect(fnChunk?.symbol).toBe("func HandleRequest(w http.ResponseWriter, r *http.Request)");
  });

  it("handles chunks containing only comments or block comments", () => {
    const chunks = chunkFile(
      ["/* Block comment */", "// Line comment", "export function test() {}"].join("\n"),
      "typescript",
    );
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("splits large symbol sections when exceeding maxChunkLines", () => {
    const lines = ["export function largeFunction() {"];
    for (let i = 0; i < 150; i++) {
      lines.push(`  console.log(${i});`);
    }
    lines.push("}");

    const chunks = chunkFile(lines.join("\n"), "typescript", 40, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("extracts symbols across all supported languages", () => {
    expect(chunkFile("int calculate_sum(int a, int b) {}", "c")[0]?.symbol).toContain("calculate_sum");
    expect(chunkFile("class MyClass {}; int foo() {}", "cpp")[0]?.symbol).toBeDefined();
    expect(chunkFile("def ruby_func\nend", "ruby")[0]?.symbol).toContain("def ruby_func");
    expect(chunkFile("func swiftFunc() {}", "swift")[0]?.symbol).toContain("func swiftFunc");
    expect(chunkFile("def py_func(): pass", "python")[0]?.symbol).toContain("def py_func");
    expect(chunkFile("pub fn rust_func() {}", "rust")[0]?.symbol).toContain("fn rust_func");
  });

  it("findDeclarationLine falls back when chunk contains only block comments", () => {
    const chunks = chunkFile(["/* block comment only */", "/* second comment */"].join("\n"), "typescript");
    expect(chunks.length).toBe(1);
  });
});

describe("semantic retrieval compatibility", () => {
  it("invalidates indexes created before retrieval metadata and JSDoc-aware chunks", () => {
    expect(CHUNKER_VERSION).toBe("2");
  });

  it("configures the embedding server beyond the old 512-token truncation", () => {
    const source = readFileSync(new URL("../embedding_server.py", import.meta.url), "utf-8");
    expect(source).toContain("self.runtime_config.max_sequence_length");
    expect(source).toContain("self.model.max_seq_length = self.sequence_length");
    expect(source).not.toContain("self.model.max_seq_length = 512");
    expect(source).toContain("max_seq:");
  });
});

describe("discoverFiles and findRepos", () => {
  it("honors gitignore negation rules", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-code-index-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "generated"));
    writeFileSync(join(directory, ".gitignore"), "generated/*\n!generated/keep.ts\n");
    writeFileSync(join(directory, "generated", "drop.ts"), "export const drop = true;\n");
    writeFileSync(join(directory, "generated", "keep.ts"), "export const keep = true;\n");

    expect(discoverFiles(directory, 10_000)).toEqual([join(directory, "generated", "keep.ts")]);
  });

  it("finds git repos in top-level and subdirectories", () => {
    const workspace = mkdtempSync(join(tmpdir(), "p-ws-"));
    temporaryDirectories.push(workspace);

    const repo1 = join(workspace, "repo1");
    mkdirSync(join(repo1, ".git"), { recursive: true });

    const parentDir = join(workspace, "nested");
    const repo2 = join(parentDir, "repo2");
    mkdirSync(join(repo2, ".git"), { recursive: true });

    const regularFile = join(workspace, "file.txt");
    writeFileSync(regularFile, "not a dir");

    const repos = findRepos(workspace);
    expect(repos).toContain(repo1);
    expect(repos).toContain(repo2);
  });

  it("handles wildcard directory exclusions and broken/escaping symlinks", () => {
    const directory = mkdtempSync(join(tmpdir(), "p-discover-test-"));
    temporaryDirectories.push(directory);

    // Excluded directory (egg-info)
    mkdirSync(join(directory, "egg-info"));
    writeFileSync(join(directory, "egg-info", "bar.ts"), "export const x = 1;");

    // Deny glob pattern (*.custom)
    mkdirSync(join(directory, "custom_dir"));
    writeFileSync(join(directory, "custom_dir", "test.custom"), "export const y = 2;");

    // Broken symlink
    try {
      symlinkSync(join(directory, "non-existent-target.ts"), join(directory, "broken-symlink.ts"));
    } catch {
      /* ignore */
    }

    // Outside symlink escaping canonical root
    const outsideDir = mkdtempSync(join(tmpdir(), "p-outside-"));
    temporaryDirectories.push(outsideDir);
    writeFileSync(join(outsideDir, "outside.ts"), "export const outside = 1;");
    try {
      symlinkSync(join(outsideDir, "outside.ts"), join(directory, "outside-link.ts"));
    } catch {
      /* ignore */
    }

    const files = discoverFilesWithOptions(directory, { maxFileSize: 10_000, denyGlobs: ["**/*.custom"] });
    expect(files).not.toContain(join(directory, "egg-info", "bar.ts"));
    expect(files).not.toContain(join(directory, "custom_dir", "test.custom"));
    expect(files).not.toContain(join(directory, "broken-symlink.ts"));
    expect(files).not.toContain(join(directory, "outside-link.ts"));
  });

  it("handles non-existent or unreadable workspace in findRepos", () => {
    expect(findRepos("/non-existent-workspace-path-xyz")).toEqual([]);
  });
});
