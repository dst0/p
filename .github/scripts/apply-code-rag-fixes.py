#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one replacement target, found {count}")
    file.write_text(text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found")
    file.write_text(text[:start_index] + replacement + text[end_index:])


replace_once(
    "packages/code-index/embedding_server.py",
    '''        self.model = SentenceTransformer(self.model_name, device=device) if device else SentenceTransformer(self.model_name)
        # Bound memory use across Metal, CUDA, and CPU environments.
        self.model.max_seq_length = 512
''',
    '''        self.model = SentenceTransformer(self.model_name, device=device) if device else SentenceTransformer(self.model_name)
        # Keep enough context for metadata-enriched code chunks while retaining a
        # conservative default for CPU and unified-memory machines.
        max_sequence_length = int(os.environ.get("P_CODE_RAG_MAX_SEQUENCE_LENGTH", "2048"))
        if max_sequence_length <= 0:
            raise ValueError("P_CODE_RAG_MAX_SEQUENCE_LENGTH must be a positive integer")
        tokenizer_limit = getattr(self.model.tokenizer, "model_max_length", max_sequence_length)
        if isinstance(tokenizer_limit, int) and 0 < tokenizer_limit < 10_000_000:
            max_sequence_length = min(max_sequence_length, tokenizer_limit)
        self.model.max_seq_length = max_sequence_length
''',
)
replace_once(
    "packages/code-index/embedding_server.py",
    '            f"Model loaded. Dim: {self.dim}, max_seq: 512, device: {self.model.device}",\n',
    '            f"Model loaded. Dim: {self.dim}, max_seq: {self.model.max_seq_length}, device: {self.model.device}",\n',
)

chunk_helpers_old = '''/**
 * From a symbol-start line index, walk backward over contiguous
 * comment lines (single-line, block, JSDoc) and blank lines to include
 * leading JSDoc in the chunk.
 */
function skipLeadingComments(lines: string[], startLine: number): number {
\tlet i = startLine;
\twhile (i > 0) {
\t\tconst prev = lines[i - 1];
\t\tif (prev.trim() === "") {
\t\t\ti -= 1;
\t\t\tcontinue;
\t\t}
\t\tif (commentLineRe.test(prev)) {
\t\t\ti -= 1;
\t\t\tcontinue;
\t\t}
\t\tbreak;
\t}
\treturn i;
}

const commentLineRe = /^\\s*(\\/\\/|\\/\\*|\\*\\s*?|\\/\\*\\*|\\*\\/)$/;

/**
 * Given the first line of a chunk (which may be a comment), find the line
 * that contains the actual symbol declaration by skipping leading comments/blanks.
 */
function findDeclarationLine(lines: string[], startLine: number): number {
\tlet i = startLine;
\twhile (i < lines.length) {
\t\tif (lines[i].trim() === "" || commentLineRe.test(lines[i])) {
\t\t\ti += 1;
\t\t\tcontinue;
\t\t}
\t\treturn i;
\t}
\treturn startLine;
}
'''
chunk_helpers_new = '''function skipBlankLinesBackward(lines: string[], startLine: number): number {
\tlet i = startLine;
\twhile (i > 0 && lines[i - 1].trim() === "") i -= 1;
\treturn i;
}

/**
 * From a symbol-start line index, walk backward over contiguous comments,
 * decorators, and blank lines so documentation remains attached to the
 * declaration it describes.
 */
function skipLeadingComments(lines: string[], startLine: number): number {
\tlet i = skipBlankLinesBackward(lines, startLine);

\twhile (i > 0 && lines[i - 1].trimStart().startsWith("@")) {
\t\ti = skipBlankLinesBackward(lines, i - 1);
\t}

\tconst previous = lines[i - 1]?.trim();
\tif (previous?.startsWith("//")) {
\t\twhile (i > 0 && lines[i - 1].trimStart().startsWith("//")) i -= 1;
\t\treturn i;
\t}

\tif (previous?.endsWith("*/")) {
\t\tfor (let blockStart = i - 1; blockStart >= 0; blockStart -= 1) {
\t\t\tif (lines[blockStart].trimStart().startsWith("/*")) return blockStart;
\t\t}
\t}

\treturn i;
}

/**
 * Given the first line of a chunk (which may be a comment), find the line
 * that contains the actual symbol declaration by skipping comments, blanks,
 * and decorators.
 */
function findDeclarationLine(lines: string[], startLine: number): number {
\tlet i = startLine;
\tlet inBlockComment = false;
\twhile (i < lines.length) {
\t\tconst trimmed = lines[i].trim();
\t\tif (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("@")) {
\t\t\ti += 1;
\t\t\tcontinue;
\t\t}
\t\tif (inBlockComment) {
\t\t\tif (trimmed.includes("*/")) inBlockComment = false;
\t\t\ti += 1;
\t\t\tcontinue;
\t\t}
\t\tif (trimmed.startsWith("/*")) {
\t\t\tinBlockComment = !trimmed.includes("*/");
\t\t\ti += 1;
\t\t\tcontinue;
\t\t}
\t\treturn i;
\t}
\treturn startLine;
}
'''
replace_once("packages/code-index/src/chunk.ts", chunk_helpers_old, chunk_helpers_new)
replace_once(
    "packages/code-index/src/chunk.ts",
    '''\tconst boundaries: number[] = [rawBoundaries[0]];
\tfor (let i = 1; i < rawBoundaries.length; i++) {
\t\tboundaries.push(skipLeadingComments(lines, rawBoundaries[i]));
\t}
''',
    '''\tconst boundaries: number[] = [rawBoundaries[0]];
\tfor (let i = 1; i < rawBoundaries.length - 1; i++) {
\t\tconst boundary = skipLeadingComments(lines, rawBoundaries[i]);
\t\tif (boundary > boundaries[boundaries.length - 1]) boundaries.push(boundary);
\t}
\t// The EOF sentinel must never move backward, otherwise trailing comments disappear.
\tif (boundaries[boundaries.length - 1] !== totalLines) boundaries.push(totalLines);
''',
)

replace_once(
    "packages/code-index/src/embed/http.ts",
    '''\tprivate serverManager: EmbeddingServerManager | null;
\tprivate options: EmbeddingProviderHttpOptions;
''',
    '''\tprivate serverManager: EmbeddingServerManager | null;
\tprivate options: EmbeddingProviderHttpOptions;
\tprivate queryInstruction: string | undefined;
''',
)
replace_once(
    "packages/code-index/src/embed/http.ts",
    '''\t\tthis.dim = dim;
\t\tthis.options = { ...DEFAULT_HTTP_OPTIONS, ...options };
''',
    '''\t\tthis.dim = dim;
\t\tthis.options = { ...DEFAULT_HTTP_OPTIONS, ...options };
\t\tthis.queryInstruction = queryInstructionForModel(model);
''',
)
replace_once(
    "packages/code-index/src/embed/http.ts",
    '''\t\tconst instructQuery = `${QUERY_INSTRUCTION}\\nQuery: ${text}`;
\t\tconst vectors = await this.encode([instructQuery], signal);
''',
    '''\t\tconst queryText = this.queryInstruction ? `Instruct: ${this.queryInstruction}\\nQuery: ${text}` : text;
\t\tconst vectors = await this.encode([queryText], signal);
''',
)
replace_once(
    "packages/code-index/src/embed/http.ts",
    '''}

/**
 * Create the default HTTP embedding provider (auto-starts server).
 */
export function createDefaultProvider''',
    '''}

function queryInstructionForModel(model: string): string | undefined {
\treturn model.toLowerCase().includes("qwen3-embedding") ? QUERY_INSTRUCTION : undefined;
}

/**
 * Create the default HTTP embedding provider (auto-starts server).
 */
export function createDefaultProvider''',
)

replace_once(
    "packages/code-index/src/rag/manifest.ts",
    'export const CHUNKER_VERSION = "1";',
    'export const CHUNKER_VERSION = "2";',
)

service_path = "packages/code-index/src/rag/service.ts"
replace_once(
    service_path,
    "// Compute drift early so we can decide whether to rebuild vocabulary even on no-change turns",
    "// Sparse vocabulary changes require a new generation so stored and query token indices stay aligned",
)
replace_between(
    service_path,
    '''\t\t\tif (changedFileCount === 0 && this.manifest && !options.forceSparseRebuild && incompatibility === undefined) {''',
    '''\n\t\t\tconst changeRatio''',
    '''\t\t\tif (
\t\t\t\tchangedFileCount === 0 &&
\t\t\t\tthis.manifest &&
\t\t\t\t!options.forceSparseRebuild &&
\t\t\t\tincompatibility === undefined &&
\t\t\t\t!sparseDriftExceeded
\t\t\t) {
\t\t\t\tfor (const file of plan.unchanged) {
\t\t\t\t\tconst entry = this.manifest.files[file.path];
\t\t\t\t\tif (entry) this.manifest.files[file.path] = { ...entry, size: file.size, mtimeMs: file.mtimeMs };
\t\t\t\t}
\t\t\t\tthis.manifest.state = "ready";
\t\t\t\tthis.manifest.updatedAt = this.now().toISOString();
\t\t\t\tdelete this.manifest.lastError;
\t\t\t\twriteManifestAtomic(this.manifestPath, this.manifest);
\t\t\t\tthis.state = "ready";
\t\t\t\tthis.staleReason = undefined;
\t\t\t\tthis.lastError = undefined;
\t\t\t\tthis.reportProgress(options.onProgress, "finalizing", 100);
\t\t\t\treturn this.summaryForPlan(plan, startedAt, 0, false);
\t\t\t}
''',
)
replace_once(
    service_path,
    '''\t\t\t\tincompatibility !== undefined ||
\t\t\t\tchangeRatio > this.settings.fullSparseRebuildChangeRatio''',
    '''\t\t\t\tincompatibility !== undefined ||
\t\t\t\tsparseDriftExceeded ||
\t\t\t\tchangeRatio > this.settings.fullSparseRebuildChangeRatio''',
)
replace_once(
    service_path,
    '''
\t\t\t// When drift is high but change ratio is low, do incremental refresh then rebuild vocabulary
\t\t\tif (sparseDriftExceeded) {
\t\t\t\treturn await this.performIncrementalRefresh(plan, startedAt, signal, options.onProgress, true);
\t\t\t}
''',
    "\n",
)
replace_once(
    service_path,
    '''\t/**
\t * Incremental refresh: embed only changed files, delete removed ones, update manifest.
\t * Optionally rebuilds the sparse vocabulary when drift exceeds the threshold.
\t */''',
    '''\t/** Incremental refresh: embed only changed files, delete removed ones, and update the manifest. */''',
)
replace_once(
    service_path,
    '''\t\tonProgress: RefreshIndexOptions["onProgress"],
\t\trebuildVocabulary = false,
\t): Promise<IndexUpdateSummary> {''',
    '''\t\tonProgress: RefreshIndexOptions["onProgress"],
\t): Promise<IndexUpdateSummary> {''',
)
replace_once(
    service_path,
    '''
\t\tif (rebuildVocabulary) {
\t\t\tawait this.rebuildSparseVocabulary(nextManifest, signal);
\t\t}
''',
    "\n",
)
replace_between(
    service_path,
    '''\t/**
\t * Rebuild the BM25 sparse vocabulary from current workspace files without re-encoding dense vectors.''',
    '''\n\tprivate refreshSettingsSilently(): void {''',
    '''\tprivate refreshSettingsSilently(): void {''',
)

code_test_path = "packages/code-index/test/code-index.test.ts"
replace_once(
    code_test_path,
    'import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";',
    'import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
)
replace_once(
    code_test_path,
    'import { BM25Vocabulary, chunkFile, DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, discoverFiles } from "../src/index.ts";\n',
    'import { BM25Vocabulary, chunkFile, DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, discoverFiles } from "../src/index.ts";\nimport { CHUNKER_VERSION } from "../src/rag/manifest.ts";\n',
)
chunk_tests = '''\t});

\tit("keeps multiline JSDoc, decorators, and trailing comments in the correct chunks", () => {
\t\tconst chunks = chunkFile(
\t\t\t[
\t\t\t\t"export const before = true;",
\t\t\t\t"",
\t\t\t\t"/**",
\t\t\t\t" * Register an LLM-callable tool with a TypeBox schema.",
\t\t\t\t" */",
\t\t\t\t"@sealed",
\t\t\t\t"export function defineTool() {}",
\t\t\t\t"// trailing implementation note",
\t\t\t].join("\\n"),
\t\t\t"typescript",
\t\t);

\t\texpect(chunks).toHaveLength(2);
\t\texpect(chunks[1]).toMatchObject({ startLine: 3, endLine: 8, symbol: "function defineTool" });
\t\texpect(chunks[1].text).toContain("Register an LLM-callable tool");
\t\texpect(chunks[1].text).toContain("@sealed");
\t\texpect(chunks[1].text).toContain("trailing implementation note");
\t});

\tit("keeps consecutive line comments with the declaration they document", () => {
\t\tconst chunks = chunkFile(
\t\t\t[
\t\t\t\t"export const before = true;",
\t\t\t\t"// Tool definition contract.",
\t\t\t\t"// Parameters use TypeBox.",
\t\t\t\t"export interface ToolDefinition {}",
\t\t\t].join("\\n"),
\t\t\t"typescript",
\t\t);

\t\texpect(chunks).toHaveLength(2);
\t\texpect(chunks[1]).toMatchObject({ startLine: 2, endLine: 4, symbol: "interface ToolDefinition" });
\t\texpect(chunks[1].text).toContain("Parameters use TypeBox");
\t});
});

describe("semantic retrieval compatibility", () => {
\tit("invalidates indexes created before retrieval metadata and JSDoc-aware chunks", () => {
\t\texpect(CHUNKER_VERSION).toBe("2");
\t});

\tit("configures the embedding server beyond the old 512-token truncation", () => {
\t\tconst source = readFileSync(new URL("../embedding_server.py", import.meta.url), "utf-8");
\t\texpect(source).toContain('P_CODE_RAG_MAX_SEQUENCE_LENGTH", "2048"');
\t\texpect(source).not.toContain("self.model.max_seq_length = 512");
\t\texpect(source).toContain("max_seq: {self.model.max_seq_length}");
\t});
});

describe("discoverFiles"'''
replace_once(
    code_test_path,
    '''\t});
});

describe("discoverFiles"''',
    chunk_tests,
)

Path("packages/code-index/test/embed-http.test.ts").write_text('''import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";

afterEach(() => {
\tvi.unstubAllGlobals();
});

function captureEmbeddingRequests(): string[][] {
\tconst requests: string[][] = [];
\tvi.stubGlobal(
\t\t"fetch",
\t\tvi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
\t\t\tconst body = JSON.parse(String(init?.body)) as { input: string[] };
\t\t\trequests.push(body.input);
\t\t\treturn new Response(
\t\t\t\tJSON.stringify({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) }),
\t\t\t\t{ status: 200, headers: { "Content-Type": "application/json" } },
\t\t\t);
\t\t}),
\t);
\treturn requests;
}

describe("EmbeddingProviderHttp.encodeQuery", () => {
\tit("uses Qwen's instruction-query format for Qwen3 embedding models", async () => {
\t\tconst requests = captureEmbeddingRequests();
\t\tconst provider = new EmbeddingProviderHttp(
\t\t\t"http://127.0.0.1:18742",
\t\t\t3,
\t\t\tfalse,
\t\t\t"Qwen/Qwen3-Embedding-0.6B",
\t\t);

\t\tawait provider.encodeQuery("tool definition system");

\t\texpect(requests).toHaveLength(1);
\t\texpect(requests[0][0]).toBe(
\t\t\t"Instruct: Given a natural-language description of software behaviour, " +
\t\t\t\t"retrieve the relevant source-code functions, types, interfaces, modules, and tool definitions.\\n" +
\t\t\t\t"Query: tool definition system",
\t\t);
\t});

\tit("does not impose a Qwen-specific instruction on other embedding models", async () => {
\t\tconst requests = captureEmbeddingRequests();
\t\tconst provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "acme/code-embed-v1");

\t\tawait provider.encodeQuery("tool definition system");

\t\texpect(requests).toEqual([["tool definition system"]]);
\t});
});
''')

rag_test_path = "packages/code-index/test/rag-service.test.ts"
replace_once(
    rag_test_path,
    '''\toptions: { embeddingModel?: string; allowSearchRefresh?: boolean } = {},''',
    '''\toptions: {
\t\tembeddingModel?: string;
\t\tallowSearchRefresh?: boolean;
\t\tsparseRebuildDriftRatio?: number;
\t} = {},''',
)
replace_once(
    rag_test_path,
    '''\t\t\tfullSparseRebuildChangeRatio: 1,
''',
    '''\t\t\tfullSparseRebuildChangeRatio: 1,
\t\t\tsparseRebuildDriftRatio: options.sparseRebuildDriftRatio ?? 1,
''',
)
replace_once(
    rag_test_path,
    '''\t\texpect(summary.status.collection).toContain(summary.status.repoId.slice(0, 16));
''',
    '''\t\texpect(summary.status.collection).toContain(summary.status.repoId.slice(0, 16));
\t\texpect(embedding.encodedTexts[0]).toContain("file: main.ts");
\t\texpect(embedding.encodedTexts[0]).toContain("language: typescript");
\t\texpect(embedding.encodedTexts[0]).toContain("symbol: function initializeAuth");
\t\texpect(embedding.encodedTexts[0]).toContain("kind: function");
''',
)
sparse_test = '''\t});

\tit("performs a full rebuild when sparse vocabulary drift exceeds its threshold", async () => {
\t\tconst { root, data } = createFixture();
\t\tconst embedding = new FakeEmbeddingProvider();
\t\tconst store = new FakeVectorStore();
\t\tconst service = createService(root, data, embedding, store, { sparseRebuildDriftRatio: 0.2 });
\t\tawait service.rebuild();
\t\tconst originalCollection = (await service.status()).collection;

\t\twriteFileSync(join(root, "main.ts"), "export const replacement = 'sparse-drift-rebuild';\\n");
\t\tconst refreshed = await service.refresh();

\t\texpect(refreshed.fullRebuild).toBe(true);
\t\texpect(refreshed.status.collection).not.toBe(originalCollection);
\t\texpect(refreshed.status.sparse.exact).toBe(true);
\t\texpect(store.allContents().join("\\n")).toContain("sparse-drift-rebuild");
\t});

\tit("indexes the latest stable contents'''
replace_once(
    rag_test_path,
    '''\t});

\tit("indexes the latest stable contents''',
    sparse_test,
)
migration_test = '''\t});

\tit("invalidates and rebuilds an index created with the previous chunker version", async () => {
\t\tconst { root, data } = createFixture();
\t\tconst embedding = new FakeEmbeddingProvider();
\t\tconst store = new FakeVectorStore();
\t\tconst original = createService(root, data, embedding, store);
\t\tawait original.rebuild();
\t\tconst originalStatus = await original.status();
\t\tawait original.dispose();

\t\tconst manifestPath = join(data, originalStatus.repoId, "manifest.json");
\t\tconst manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
\t\t\tchunker: { version: string };
\t\t};
\t\tmanifest.chunker.version = "1";
\t\twriteFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\\n`);

\t\tconst migrated = createService(root, data, embedding, store);
\t\tconst stale = await migrated.initialize();
\t\texpect(stale).toMatchObject({
\t\t\tstate: "stale",
\t\t\tlastError: { code: "RAG_INCOMPATIBLE_INDEX", message: "Chunker version changed" },
\t\t});

\t\tconst rebuilt = await migrated.refresh();
\t\texpect(rebuilt.fullRebuild).toBe(true);
\t\texpect(rebuilt.status.collection).not.toBe(originalStatus.collection);
\t\tawait migrated.dispose();
\t});

\tit("rebuilds when the persisted Qdrant collection is missing'''
replace_once(
    rag_test_path,
    '''\t});

\tit("rebuilds when the persisted Qdrant collection is missing''',
    migration_test,
)
