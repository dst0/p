import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BM25Vocabulary, chunkFile, discoverFiles } from "../src/index.ts";

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
