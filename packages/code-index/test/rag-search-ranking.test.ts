import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceCodeRagService } from "../src/rag/service.ts";
import type { StoredChunkPayload } from "../src/rag/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RAG search query formatting, hit ranking, and snippet truncation", () => {
  it("truncates chunks exceeding maxResultCharacters and sets truncated flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-trunc-test-"));
    temporaryDirectories.push(dir);

    const payloadLong: StoredChunkPayload = {
      repoId: "r1",
      fileId: "f1",
      path: "src/long.ts",
      language: "typescript",
      symbolName: "fnLong",
      symbolType: "function",
      startLine: 1,
      endLine: 100,
      fileHash: "h1",
      chunkHash: "c1",
      chunkOrdinal: 0,
      chunkerVersion: "2",
      indexGeneration: "gen1",
      isTest: false,
      isGenerated: false,
      content: "x".repeat(5000), // > maxResultCharacters (4000)
      indexedAt: "2026-01-01",
    };

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
    });

    const formatRes = (
      service as unknown as {
        formatHits: (
          candidates: Array<{ score: number; payload: StoredChunkPayload }>,
          input: unknown,
        ) => { hits: Array<{ content: string }>; truncated: boolean };
      }
    ).formatHits([{ score: 0.9, payload: payloadLong }], {
      query: "test",
      limit: 10,
      includeTests: true,
      includeGenerated: false,
      freshness: "prefer_fresh",
    });

    expect(formatRes.truncated).toBe(true);
    expect(formatRes.hits[0].content).toContain("[snippet truncated]");
  });

  it("filters search hits by pathPrefix matching repository subpaths", () => {
    const dir = mkdtempSync(join(tmpdir(), "p-prefix-test-"));
    temporaryDirectories.push(dir);

    const payload1: StoredChunkPayload = {
      repoId: "r1",
      fileId: "f1",
      path: "src/components/button.ts",
      language: "typescript",
      symbolName: "Button",
      symbolType: "function",
      startLine: 1,
      endLine: 10,
      fileHash: "h1",
      chunkHash: "c1",
      chunkOrdinal: 0,
      chunkerVersion: "2",
      indexGeneration: "gen1",
      isTest: false,
      isGenerated: false,
      content: "export const Button = () => {};",
      indexedAt: "2026-01-01",
    };

    const service = new WorkspaceCodeRagService({
      workspaceRoot: dir,
      dataDirectory: join(dir, "data"),
      manageLocalBackends: false,
    });

    const res = (
      service as unknown as {
        formatHits: (
          candidates: Array<{ score: number; payload: StoredChunkPayload }>,
          input: unknown,
        ) => { hits: Array<{ content: string }>; truncated: boolean };
      }
    ).formatHits([{ score: 0.9, payload: payload1 }], {
      query: "test",
      limit: 10,
      pathPrefix: "src/utils",
      includeTests: true,
      includeGenerated: false,
      freshness: "prefer_fresh",
    });

    expect(res.hits).toHaveLength(0);
  });

  it("validates repository relative paths and rejects directory escaping path filters", () => {
    const service = new WorkspaceCodeRagService({
      workspaceRoot: "/tmp",
      dataDirectory: "/tmp/data",
      manageLocalBackends: false,
    });

    expect(() =>
      (service as unknown as { normalizeSearchInput: (i: unknown) => void }).normalizeSearchInput({
        query: "q",
        pathPrefix: "../escape",
      }),
    ).toThrow("Path filter cannot escape the repository");

    expect(() =>
      (service as unknown as { normalizeSearchInput: (i: unknown) => void }).normalizeSearchInput({
        query: "q",
        pathPrefix: "/abs/path",
      }),
    ).toThrow("Path filter must be repository-relative");
  });

  it("filters by symbolTypes and limits max chunks per file to 3", () => {
    const service = new WorkspaceCodeRagService({
      workspaceRoot: "/tmp",
      dataDirectory: "/tmp/data",
      manageLocalBackends: false,
    });

    const candidates = Array.from({ length: 6 }, (_, i) => ({
      score: 1.0 - i * 0.1,
      payload: {
        repoId: "r1",
        fileId: "f1",
        path: "src/file.ts",
        language: "typescript",
        symbolName: `sym_${i}`,
        symbolType: i === 0 ? ("function" as const) : ("class" as const),
        startLine: i * 10 + 1,
        endLine: (i + 1) * 10,
        fileHash: "h1",
        chunkHash: `ch_${i}`,
        chunkOrdinal: i,
        chunkerVersion: "2",
        indexGeneration: "gen1",
        isTest: false,
        isGenerated: false,
        content: `code ${i}`,
        indexedAt: "2026-01-01",
      },
    }));

    const symbolFiltered = (
      service as unknown as {
        formatHits: (
          candidates: Array<{ score: number; payload: StoredChunkPayload }>,
          input: unknown,
        ) => { hits: Array<{ symbolName?: string }>; truncated: boolean };
      }
    ).formatHits(candidates, {
      query: "q",
      limit: 10,
      symbolTypes: ["function"],
      freshness: "prefer_fresh",
    });
    expect(symbolFiltered.hits).toHaveLength(1);
    expect(symbolFiltered.hits[0].symbolName).toBe("sym_0");

    const allFiltered = (
      service as unknown as {
        formatHits: (
          candidates: Array<{ score: number; payload: StoredChunkPayload }>,
          input: unknown,
        ) => { hits: Array<{ symbolName?: string }>; truncated: boolean };
      }
    ).formatHits(candidates, {
      query: "q",
      limit: 10,
      freshness: "prefer_fresh",
    });
    // Deduplicated per file to max 3 hits
    expect(allFiltered.hits).toHaveLength(3);
  });

  it("handles limit reached and maxContextCharacters overflow", () => {
    const service = new WorkspaceCodeRagService({
      workspaceRoot: "/tmp",
      dataDirectory: "/tmp/data",
      manageLocalBackends: false,
    });

    const candidates = Array.from({ length: 5 }, (_, i) => ({
      score: 1.0 - i * 0.1,
      payload: {
        repoId: "r1",
        fileId: `f${i}`,
        path: `src/file_${i}.ts`,
        language: "typescript",
        symbolName: `sym_${i}`,
        symbolType: "function" as const,
        startLine: 1,
        endLine: 10,
        fileHash: `h${i}`,
        chunkHash: `ch_${i}`,
        chunkOrdinal: 0,
        chunkerVersion: "2",
        indexGeneration: "gen1",
        isTest: false,
        isGenerated: false,
        content: `content ${i}`,
        indexedAt: "2026-01-01",
      },
    }));

    // Hit limit 2
    const limitResult = (
      service as unknown as {
        formatHits: (
          candidates: Array<{ score: number; payload: StoredChunkPayload }>,
          input: unknown,
        ) => { hits: Array<{ content: string }>; truncated: boolean };
      }
    ).formatHits(candidates, {
      query: "q",
      limit: 2,
      freshness: "prefer_fresh",
    });
    expect(limitResult.hits).toHaveLength(2);
  });
});
