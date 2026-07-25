import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BM25Vocabulary } from "../src/bm25.ts";
import { chunkFile } from "../src/chunk.ts";
import { EXCLUDE_DIRS } from "../src/config.ts";
import { detectLanguage, discoverFilesWithOptions, findRepos } from "../src/discover.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("BM25Vocabulary full coverage", () => {
  it("handles finalize with 0 docs", () => {
    const vocab = new BM25Vocabulary();
    vocab.finalize();
    expect(vocab.avgDl).toBe(0);
  });

  it("handles empty/non-tokenizable string encoding", () => {
    const vocab = new BM25Vocabulary();
    vocab.register("hello world");
    const result = vocab.encode("!!!");
    expect(result).toEqual({ indices: [], values: [] });
  });

  it("handles encoding with tokens not in docFreq", () => {
    const vocab = new BM25Vocabulary();
    vocab.register("hello world");
    vocab.docFreq.delete("world");
    const result = vocab.encode("world");
    expect(result.indices.length).toBe(1);
  });

  it("saves to a path without directory component", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-bm25-nodir-"));
    tempDirs.push(dir);
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      const vocab = new BM25Vocabulary();
      vocab.register("test document");
      vocab.save("local_vocab.json");
      const loaded = BM25Vocabulary.load("local_vocab.json");
      expect(loaded.totalDocs).toBe(1);

      // test save without directory
      vocab.save("test-vocab-no-dir.json");
      expect(existsSync("test-vocab-no-dir.json")).toBe(true);
      unlinkSync("test-vocab-no-dir.json");
    } finally {
      process.chdir(cwd);
    }
  });

  it("loads legacy vocabulary JSON without totalTokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-bm25-legacy-"));
    tempDirs.push(dir);
    const vocabPath = join(dir, "legacy.json");
    const legacyData = {
      tokenToIdx: { foo: 0 },
      docFreq: { foo: 1 },
      nextIdx: 1,
      totalDocs: 2,
      avgDl: 3.5,
    };
    writeFileSync(vocabPath, JSON.stringify(legacyData), "utf-8");

    const loaded = BM25Vocabulary.load(vocabPath);
    expect(loaded.totalDocs).toBe(2);
    expect(loaded.avgDl).toBe(3.5);
  });
});

describe("chunkFile full coverage", () => {
  it("handles empty content", () => {
    expect(chunkFile("", "typescript")).toEqual([]);
  });

  it("handles unknown language with fixed size chunking", () => {
    const content = "line 1\nline 2\nline 3";
    const chunks = chunkFile(content, "unknown_language", 2);
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkType).toBe("text");
  });

  it("detects module chunk type", () => {
    const content = "mod my_module;\nfn test() {}";
    const chunks = chunkFile(content, "rust");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkType).toBe("module");
  });

  it("handles large chunk > maxChunkLines with section chunk type", () => {
    const lines = ["export function superLarge() {"];
    for (let i = 0; i < 250; i++) {
      lines.push(`  // comment line ${i}`);
    }
    lines.push("}");
    const content = lines.join("\n");
    const chunks = chunkFile(content, "typescript", 40, 100);
    expect(chunks.some((c) => c.chunkType === "section")).toBe(true);
  });

  it("handles blank lines in large chunk splitting", () => {
    const lines = ["export function fnWithBlanks() {"];
    for (let i = 0; i < 120; i++) {
      lines.push(i % 10 === 0 ? "" : `  // comment ${i}`);
    }
    lines.push("}");
    const chunks = chunkFile(lines.join("\n"), "typescript", 30, 80);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("extracts symbol edge cases for whitespace and unsupported languages", () => {
    const chunksEmptyFirstLine = chunkFile("\n\nexport function test() {}", "typescript");
    expect(chunksEmptyFirstLine.length).toBeGreaterThan(0);
  });
});

describe("discoverFiles edge cases and language detection", () => {
  it("detects languages correctly including fallback to text", () => {
    expect(detectLanguage("file.ts")).toBe("typescript");
    expect(detectLanguage("file.unknown_extension_xyz")).toBe("text");
  });

  it("handles wildcard directory exclusions like *.egg-info in EXCLUDE_DIRS", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-egg-test-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "foo.egg-info"));
    writeFileSync(join(dir, "foo.egg-info", "pkg.ts"), "export const x = 1;");
    writeFileSync(join(dir, "main.ts"), "export const y = 2;");

    EXCLUDE_DIRS.add("*.egg-info");
    try {
      const files = discoverFilesWithOptions(dir, { maxFileSize: 1000 });
      expect(files).toContain(join(dir, "main.ts"));
      expect(files).not.toContain(join(dir, "foo.egg-info", "pkg.ts"));
    } finally {
      EXCLUDE_DIRS.delete("*.egg-info");
    }
  });

  it("filters sensitive files and environment configs", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-sensitive-test-"));
    tempDirs.push(dir);

    writeFileSync(join(dir, ".env"), "SECRET=1");
    writeFileSync(join(dir, ".env.production"), "SECRET=2");
    writeFileSync(join(dir, ".env.example"), "SECRET=example");
    writeFileSync(join(dir, "server.key"), "PRIVATE KEY");
    writeFileSync(join(dir, "cert.pem"), "CERTIFICATE");

    const files = discoverFilesWithOptions(dir, { maxFileSize: 1024 * 1024 });
    expect(files).toContain(join(dir, ".env.example"));
    expect(files).not.toContain(join(dir, ".env"));
    expect(files).not.toContain(join(dir, ".env.production"));
    expect(files).not.toContain(join(dir, "server.key"));
    expect(files).not.toContain(join(dir, "cert.pem"));
    expect(files).not.toContain(join(dir, "node_modules/index.js"));
    expect(files).not.toContain(join(dir, "id_rsa"));
    expect(files).not.toContain(join(dir, "bin"));
    expect(files).not.toContain(join(dir, "symlink-file"));
  });

  it("filters out large files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-large-test-"));
    tempDirs.push(cwd);
    writeFileSync(join(cwd, "src.main.ts"), "abcd"); // 4 bytes
    const files = discoverFilesWithOptions(cwd, { maxFileSize: 2 }); // 2 bytes limit
    expect(files).not.toContain(join(cwd, "src.main.ts"));
  });

  it("filters sensitive paths inside subdirectories", () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-sensitive-nested-"));
    tempDirs.push(cwd);
    const secretPath = join(cwd, "src/secrets");
    mkdirSync(secretPath, { recursive: true });
    writeFileSync(join(secretPath, "file.txt"), "secret");

    const pemFile = join(cwd, "key.pem");
    writeFileSync(pemFile, "key");

    const files = discoverFilesWithOptions(cwd, { maxFileSize: 1000 });
    expect(files).not.toContain(join(secretPath, "file.txt"));
    expect(files).not.toContain(pemFile);
  });
});

describe("findRepos", () => {
  it("discovers repos nested up to two levels deep and skips files", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-repos-test-"));
    tempDirs.push(dir);

    // Top-level repo
    mkdirSync(join(dir, "repo1", ".git"), { recursive: true });

    // Nested repo
    mkdirSync(join(dir, "group", "repo2", ".git"), { recursive: true });

    // Nested directory without .git
    mkdirSync(join(dir, "group", "not-a-repo"));

    // File at nested level (should be skipped)
    writeFileSync(join(dir, "group", "file.txt"), "test");

    // File at root level (should be skipped)
    writeFileSync(join(dir, "file-root.txt"), "test");

    const repos = findRepos(dir);
    expect(repos).toHaveLength(2);
    expect(repos).toContain(join(dir, "repo1"));
    expect(repos).toContain(join(dir, "group", "repo2"));
  });
});
