import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as EmbedExports from "../src/embed.ts";
import * as IndexExports from "../src/index.ts";

describe("Barrel Exports (src/index.ts and src/embed.ts)", () => {
  it("exports expected symbols from src/index.ts", () => {
    expect(IndexExports.BM25Vocabulary).toBeDefined();
    expect(IndexExports.computePointId).toBeDefined();
    expect(IndexExports.chunkFile).toBeDefined();
    expect(IndexExports.createConfig).toBeDefined();
    expect(IndexExports.DEFAULT_CONFIG).toBeDefined();
    expect(IndexExports.EXCLUDE_DIRS).toBeDefined();
    expect(IndexExports.EXCLUDE_EXTS).toBeDefined();
    expect(IndexExports.LANG_MAP).toBeDefined();
    expect(IndexExports.detectLanguage).toBeDefined();
    expect(IndexExports.discoverFiles).toBeDefined();
    expect(IndexExports.discoverFilesWithOptions).toBeDefined();
    expect(IndexExports.findRepos).toBeDefined();
    expect(IndexExports.getGitInfo).toBeDefined();
    expect(IndexExports.loadGitignore).toBeDefined();
    expect(IndexExports.EmbeddingProviderHttp).toBeDefined();
    expect(IndexExports.EmbeddingServerManager).toBeDefined();
    expect(IndexExports.QdrantServerManager).toBeDefined();
    expect(IndexExports.CodeIndexer).toBeDefined();
    expect(IndexExports.QdrantClient).toBeDefined();
    expect(IndexExports.DEFAULT_WORKSPACE_CODE_RAG_SETTINGS).toBeDefined();
    expect(IndexExports.loadWorkspaceCodeRagSettings).toBeDefined();
    expect(IndexExports.CodeRagError).toBeDefined();
    expect(IndexExports.WorkspaceCodeRagService).toBeDefined();
    expect(IndexExports.QdrantVectorStore).toBeDefined();
    const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
    expect(IndexExports.CODE_INDEX_VERSION).toBe(packageVersion);
  });

  it("exports expected symbols from src/embed.ts", () => {
    expect(EmbedExports.createDefaultProvider).toBeDefined();
    expect(EmbedExports.EmbeddingProviderHttp).toBeDefined();
    expect(EmbedExports.QdrantServerManager).toBeDefined();
    expect(EmbedExports.EmbeddingServerManager).toBeDefined();
    expect(EmbedExports.EMBED_MODULE_VERSION).toBe("1.0.0");
  });
});
