import type { Chunk } from "./types.ts";

/** Chunking patterns per language. */
const CHUNK_PATTERNS: Record<string, RegExp> = {
	rust: /^\s*(pub\s+)?(fn|struct|enum|impl|trait|mod)\s+/gm,
	python: /^\s*(def |class |async def )/gm,
	javascript: /^\s*(function |const |let |var |class |async function |\w+\s*=.*=>|\w+\s*\(|module\.exports)/gm,
	typescript:
		/^\s*(function |const |let |var |class |async function |interface |type |enum |export |\w+\s*=.*=>|\w+\s*\(|module\.exports)/gm,
	go: /^\s*func\s+/gm,
	java: /^\s*(public |private |protected |static )*(void |String|int|boolean|long|double|float|char|byte|short|\w+)\s+\w+\s*\(/gm,
	cpp: /^\s*(void |String|int|bool|long|double|float|char|auto|\w+)\s+\w+\s*\(|^\s*(class |struct )/gm,
	c: /^\s*(void |int|char|float|double|long|short|unsigned|signed|struct|\w+)\s+\w+\s*\(/gm,
	ruby: /^\s*(def |class )/gm,
	swift: /^\s*(func |class |struct |enum |protocol )/gm,
};

/**
 * Extract a symbol name from the first line of a chunk.
 */
function extractSymbol(firstLine: string, language: string): string {
	if (!firstLine.trim()) return "";

	const patterns: Record<string, RegExp> = {
		rust: /\b(fn|struct|enum|impl|trait)\s+(\w+)/,
		python: /\b(def|async def|class)\s+(\w+)/,
		javascript: /\b(function|class|const|let|var|interface|type|enum)\s+(\w+)/,
		typescript: /\b(function|class|const|let|var|interface|type|enum)\s+(\w+)/,
		go: /\bfunc\s+(\w+\([^)]*\)|\w+)/,
		cpp: /\b(\w+)\s+(\w+)\s*\(/,
		c: /\b(\w+)\s+(\w+)\s*\(/,
		ruby: /\b(def|class)\s+(\w+)/,
		swift: /\b(func|class|struct|enum|protocol)\s+(\w+)/,
	};

	const re = patterns[language];
	if (!re) return "";

	const m = firstLine.match(re);
	if (!m) return "";

	if (language === "go") {
		return `func ${m[1]}`;
	}

	return `${m[1]} ${m[2]}`;
}

/**
 * Detect the type of a chunk from its text.
 */
function detectChunkType(text: string, _language: string): string {
	if (/\b(fn|function|def|func)\s+\w+/.test(text)) return "function";
	if (/\b(class|struct|enum)\s+\w+/.test(text)) return "class";
	if (/\b(mod|module|namespace)\b/.test(text)) return "module";
	return "text";
}

/**
 * From a symbol-start line index, walk backward over contiguous
 * comment lines (single-line, block, JSDoc) and blank lines to include
 * leading JSDoc in the chunk.
 */
function skipLeadingComments(lines: string[], startLine: number): number {
	let i = startLine;
	while (i > 0) {
		const prev = lines[i - 1];
		if (prev.trim() === "") {
			i -= 1;
			continue;
		}
		if (commentLineRe.test(prev)) {
			i -= 1;
			continue;
		}
		break;
	}
	return i;
}

const commentLineRe = /^\s*(\/\/|\/\*|\*\s*?|\/\*\*|\*\/)$/;

/**
 * Given the first line of a chunk (which may be a comment), find the line
 * that contains the actual symbol declaration by skipping leading comments/blanks.
 */
function findDeclarationLine(lines: string[], startLine: number): number {
	let i = startLine;
	while (i < lines.length) {
		if (lines[i].trim() === "" || commentLineRe.test(lines[i])) {
			i += 1;
			continue;
		}
		return i;
	}
	return startLine;
}

/**
 * Chunk a file's content into semantic pieces.
 *
 * Uses language-aware symbol boundaries when possible,
 * falls back to fixed-size line chunks.
 */
export function chunkFile(
	content: string,
	language: string,
	defaultChunkLines: number = 80,
	maxChunkLines: number = 300,
): Chunk[] {
	const lines = content.split("\n");
	if (lines.at(-1) === "") lines.pop();
	const totalLines = lines.length;

	if (totalLines === 0) return [];

	const pattern = CHUNK_PATTERNS[language];

	if (pattern) {
		return chunkBySymbols(lines, content, language, pattern, totalLines, defaultChunkLines, maxChunkLines);
	}

	// Fallback: fixed-size chunks
	return chunkFixedSize(lines, totalLines, defaultChunkLines);
}

function chunkBySymbols(
	lines: string[],
	content: string,
	language: string,
	pattern: RegExp,
	totalLines: number,
	defaultChunkLines: number,
	maxChunkLines: number,
): Chunk[] {
	// Find raw symbol boundaries, then backtrack each over leading comments/JSDoc
	const rawBoundaries = [0];

	const matches = content.matchAll(pattern);
	for (const match of matches) {
		const lineIndex = content.slice(0, match.index).split("\n").length - 1;
		if (lineIndex > 0 && lineIndex < totalLines) {
			rawBoundaries.push(lineIndex);
		}
	}
	rawBoundaries.push(totalLines);

	const boundaries: number[] = [rawBoundaries[0]];
	for (let i = 1; i < rawBoundaries.length; i++) {
		boundaries.push(skipLeadingComments(lines, rawBoundaries[i]));
	}

	const chunks: Chunk[] = [];

	for (let i = 0; i < boundaries.length - 1; i++) {
		const start = boundaries[i];
		const end = boundaries[i + 1];
		const chunkLines = lines.slice(start, end);

		if (end - start > maxChunkLines) {
			// Split large sections into fixed-size chunks
			for (let s = start; s < end; s += defaultChunkLines) {
				const e = Math.min(s + defaultChunkLines, end);
				const chunkText = lines.slice(s, e).join("\n");

				if (chunkText.trim()) {
					const declLine = findDeclarationLine(lines, s);
					chunks.push({
						text: chunkText,
						startLine: s + 1,
						endLine: e,
						symbol: extractSymbol(lines[declLine].trim(), language),
						chunkType: chunkLines.length < 200 ? "function" : "section",
					});
				}
			}
		} else {
			const chunkText = chunkLines.join("\n");

			if (chunkText.trim()) {
				const declLine = findDeclarationLine(lines, start);
				chunks.push({
					text: chunkText,
					startLine: start + 1,
					endLine: end,
					symbol: extractSymbol(lines[declLine].trim(), language),
					chunkType: detectChunkType(chunkText, language),
				});
			}
		}
	}

	return chunks;
}

function chunkFixedSize(lines: string[], totalLines: number, defaultChunkLines: number): Chunk[] {
	const chunks: Chunk[] = [];

	for (let start = 0; start < totalLines; start += defaultChunkLines) {
		const end = Math.min(start + defaultChunkLines, totalLines);
		const chunkText = lines.slice(start, end).join("\n");

		if (chunkText.trim()) {
			chunks.push({
				text: chunkText,
				startLine: start + 1,
				endLine: end,
				symbol: "",
				chunkType: "text",
			});
		}
	}

	return chunks;
}
