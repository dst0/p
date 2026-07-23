import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BM25Vocabulary, chunkFile, DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, discoverFiles } from "../src/index.ts";
import { CHUNKER_VERSION } from "../src/rag/manifest.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("BM25Vocabulary", () => {
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
});

describe("workspace RAG defaults", () => {
	it("allows enough time for a local embedding query while indexing is active", () => {
		expect(DEFAULT_WORKSPACE_CODE_RAG_SETTINGS.searchTimeoutMs).toBe(30_000);
	});
});

describe("chunkFile", () => {
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
});

describe("semantic retrieval compatibility", () => {
	it("invalidates indexes created before retrieval metadata and JSDoc-aware chunks", () => {
		expect(CHUNKER_VERSION).toBe("2");
	});

	it("configures the embedding server beyond the old 512-token truncation", () => {
		const source = readFileSync(new URL("../embedding_server.py", import.meta.url), "utf-8");
		expect(source).toContain('P_CODE_RAG_MAX_SEQUENCE_LENGTH", "2048"');
		expect(source).not.toContain("self.model.max_seq_length = 512");
		expect(source).toContain("max_seq: {self.model.max_seq_length}");
	});
});

describe("discoverFiles", () => {
	it("honors gitignore negation rules", () => {
		const directory = mkdtempSync(join(tmpdir(), "p-code-index-"));
		temporaryDirectories.push(directory);
		mkdirSync(join(directory, "generated"));
		writeFileSync(join(directory, ".gitignore"), "generated/*\n!generated/keep.ts\n");
		writeFileSync(join(directory, "generated", "drop.ts"), "export const drop = true;\n");
		writeFileSync(join(directory, "generated", "keep.ts"), "export const keep = true;\n");

		expect(discoverFiles(directory, 10_000)).toEqual([join(directory, "generated", "keep.ts")]);
	});
});
