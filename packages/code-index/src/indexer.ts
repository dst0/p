import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BM25Vocabulary, computePointId } from "./bm25.ts";
import { chunkFile } from "./chunk.ts";
import { createConfig } from "./config.ts";
import { detectLanguage, discoverFiles, getGitInfo } from "./discover.ts";
import { EmbeddingProviderHttp } from "./embed/http.ts";
import type { EmbeddingProvider } from "./embed/provider.ts";
import { QdrantClient } from "./qdrant.ts";
import type { ChunkPayload, IndexConfig, IndexStats, SearchResult } from "./types.ts";

interface RepoChunk {
	id: number;
	text: string;
	payload: ChunkPayload;
}

/**
 * Main indexer that orchestrates the 3-pass pipeline:
 * 1. Chunk all files, collect texts for vocabulary
 * 2. Register vocabulary (BM25 doc frequencies)
 * 3. Encode (dense + sparse) and upload to Qdrant
 */
export class CodeIndexer {
	private config: IndexConfig;
	public vocab: BM25Vocabulary;
	public encoder: EmbeddingProvider;
	public qdrant: QdrantClient;

	constructor(configOrPartial?: Partial<IndexConfig>) {
		this.config = createConfig(configOrPartial);
		this.vocab = new BM25Vocabulary();
		this.encoder = new EmbeddingProviderHttp(this.config.embeddingServerUrl, this.config.denseDim);
		this.qdrant = new QdrantClient(this.config);
	}

	/**
	 * No-op: HTTP provider doesn't need model loading.
	 */
	async load(): Promise<void> {
		// HTTP provider is ready on first request
	}

	/**
	 * Load BM25 vocabulary from disk (for search without re-indexing).
	 */
	async loadVocab(): Promise<boolean> {
		if (fs.existsSync(this.config.vocabPath)) {
			console.log(`📚 Loading BM25 vocabulary from ${this.config.vocabPath}...`);
			this.vocab = BM25Vocabulary.load(this.config.vocabPath);
			console.log(`✅ Vocabulary loaded (${this.vocab.tokenToIdx.size} tokens, ${this.vocab.totalDocs} docs)`);
			return true;
		}
		return false;
	}

	/**
	 * Index a single repository.
	 */
	async indexRepo(repoPath: string): Promise<IndexStats> {
		const repoName = path.basename(repoPath);
		const relRepo = path.relative(this.config.workspace, repoPath);

		console.log(`\n📦 Indexing ${repoName} (${relRepo})...`);

		const gitInfo = getGitInfo(repoPath);
		console.log(`  branch=${gitInfo.branch || "?"}, commit=${gitInfo.commit || "?"}`);

		const files = discoverFiles(repoPath, this.config.maxFileSize);
		console.log(`  Found ${files.length} source files`);

		const stats: IndexStats = { files: 0, chunks: 0, skipped: 0, errors: 0 };
		const repoChunks: RepoChunk[] = [];
		const allChunkTexts: string[] = [];

		// ── Pass 1: chunk all files, collect texts for vocabulary ──
		for (let idx = 0; idx < files.length; idx++) {
			const fpath = files[idx];

			if ((idx + 1) % 200 === 0 || idx === 0) {
				console.log(`    📄 Chunking: ${idx + 1}/${files.length} files`);
			}

			try {
				const content = fs.readFileSync(fpath, "utf-8");
				const fileHash = createHash("sha256").update(content).digest("hex");
				const relPath = path.relative(repoPath, fpath);
				const absPath = fs.realpathSync(fpath);
				const language = detectLanguage(fpath);

				const chunks = chunkFile(content, language, this.config.defaultChunkLines, this.config.maxChunkLines);

				if (chunks.length === 0) {
					stats.skipped++;
					continue;
				}

				for (const chunk of chunks) {
					const chunkHash = createHash("sha256").update(chunk.text).digest("hex");
					const pointId = computePointId(fileHash, chunk.startLine);

					repoChunks.push({
						id: pointId,
						text: chunk.text,
						payload: {
							workspace: "local-dev",
							repo: repoName,
							repoPath: relRepo,
							path: relPath,
							absPath,
							language,
							symbol: chunk.symbol,
							chunkType: chunk.chunkType,
							startLine: chunk.startLine,
							endLine: chunk.endLine,
							fileHash,
							chunkHash,
							branch: gitInfo.branch,
							commit: gitInfo.commit,
							lastIndexed: new Date().toISOString(),
						},
					});
					allChunkTexts.push(chunk.text);
				}

				stats.files++;
				stats.chunks += chunks.length;
			} catch (e) {
				stats.errors++;
				console.error(`  ❌ Error processing ${fpath}: ${e}`);
			}
		}

		// ── Pass 2: register vocabulary ──
		console.log(`  📚 Building BM25 vocabulary from ${allChunkTexts.length} chunks...`);
		const vocabStart = Date.now();

		for (let idx = 0; idx < allChunkTexts.length; idx++) {
			this.vocab.register(allChunkTexts[idx]);

			if ((idx + 1) % 2000 === 0) {
				const pct = (((idx + 1) / allChunkTexts.length) * 100).toFixed(0);
				console.log(`    📚 Vocab: ${idx + 1}/${allChunkTexts.length} (${pct}%)`);
			}
		}

		this.vocab.finalize();
		const vocabMs = Date.now() - vocabStart;
		console.log(`  ✅ Vocabulary: ${this.vocab.tokenToIdx.size} unique tokens (${vocabMs}ms)`);

		// ── Pass 3: encode + upload ──
		console.log(`  🔢 Encoding ${repoChunks.length} chunks (${this.config.denseDim}-dim dense + BM25 sparse)...`);
		const encodeStart = Date.now();
		const total = repoChunks.length;

		// Truncate long chunks for encoding
		const truncate = (text: string) => text.slice(0, this.config.maxEncodeChars);

		// Batch encode dense vectors — single contiguous Float32Array to minimize GC
		const denseVectors = new Float32Array(total * this.config.denseDim);

		for (let i = 0; i < total; i += this.config.encodeBatchSize) {
			const batchTexts = repoChunks.slice(i, i + this.config.encodeBatchSize).map((rc) => truncate(rc.text));

			const batchVecs = await this.encoder.encode(batchTexts);

			for (let j = 0; j < batchVecs.length; j++) {
				const offset = (i + j) * this.config.denseDim;
				denseVectors.set(batchVecs[j], offset);
			}

			const encodedSoFar = Math.min(i + this.config.encodeBatchSize, total);
			const pct = ((encodedSoFar / total) * 100).toFixed(0);
			const elapsed = (Date.now() - encodeStart) / 1000;
			const rate = (encodedSoFar / elapsed).toFixed(1);
			const eta = (total - encodedSoFar) / (encodedSoFar / elapsed);
			console.log(`    📊 Dense: ${encodedSoFar}/${total} (${pct}%, ${rate} chunks/s, ETA ${eta.toFixed(0)}s)`);
		}

		// Build sparse vectors and assemble points
		const points: Array<{
			id: number;
			vectors: { dense: number[]; sparse: { indices: number[]; values: number[] } };
			payload: ChunkPayload;
		}> = [];

		for (let i = 0; i < total; i++) {
			const sparseVec = this.vocab.encode(repoChunks[i].text, this.config.bm25K1, this.config.bm25B);

			points.push({
				id: repoChunks[i].id,
				vectors: {
					dense: Array.from(denseVectors.subarray(i * this.config.denseDim, (i + 1) * this.config.denseDim)),
					sparse: sparseVec,
				},
				payload: repoChunks[i].payload,
			});

			// Periodic progress
			if ((i + 1) % 200 === 0 || i + 1 === total) {
				const pct = (((i + 1) / total) * 100).toFixed(0);
				const elapsed = (Date.now() - encodeStart) / 1000;
				const rate = ((i + 1) / elapsed).toFixed(0);
				console.log(`    📊 ${i + 1}/${total} assembled (${pct}%, ${rate} chunks/s)`);
			}

			// Batch upload
			if (points.length >= this.config.batchSize) {
				await this.qdrant.upsertBatch(points);
				points.length = 0;
			}
		}

		// Upload remaining
		if (points.length > 0) {
			await this.qdrant.upsertBatch(points);
		}

		const totalMs = Date.now() - encodeStart;
		console.log(
			`  ✅ Done: ${stats.files} files, ${stats.chunks} chunks, ${stats.skipped} skipped, ${stats.errors} errors (${totalMs}ms)`,
		);

		// Save vocabulary
		this.vocab.save(this.config.vocabPath);
		console.log(`  💾 BM25 vocabulary saved to ${this.config.vocabPath}`);

		return stats;
	}

	/**
	 * Hybrid search: encode query with both dense and sparse, search Qdrant.
	 */
	async search(query: string, limit: number = 10): Promise<SearchResult[]> {
		const denseVec = await this.encoder.encodeQuery(query);
		const sparseVec = this.vocab.encode(query, this.config.bm25K1, this.config.bm25B);

		const results = await this.qdrant.search(denseVec, sparseVec, limit);

		console.log(`\n🔍 Query: '${query}'`);
		console.log(`Found ${results.length} results:\n`);

		for (let i = 0; i < results.length; i++) {
			const hit = results[i];
			const p = hit.payload;
			const symbol = p.symbol ? `  ← ${p.symbol}:` : "";
			console.log(
				`  ${i + 1}. score=${hit.score.toFixed(4)} ${p.repo}/${p.path} ` +
					`#${p.startLine}-${p.endLine} [${p.language}]${symbol}`,
			);
		}

		return results;
	}

	/**
	 * Dense-only search (when vocabulary is not available).
	 */
	async searchDense(query: string, limit: number = 10): Promise<SearchResult[]> {
		const denseVec = await this.encoder.encodeQuery(query);
		const results = await this.qdrant.searchDense(denseVec, limit);

		console.log(`\n🔍 Query: '${query}' (dense-only) — found ${results.length} results:\n`);

		for (let i = 0; i < results.length; i++) {
			const hit = results[i];
			const p = hit.payload;
			const symbol = p.symbol ? `  ← ${p.symbol}:` : "";
			console.log(
				`  ${i + 1}. score=${hit.score.toFixed(4)} ${p.repo}/${p.path} ` +
					`#${p.startLine}-${p.endLine} [${p.language}]${symbol}`,
			);
		}

		return results;
	}

	/**
	 * Get index status.
	 */
	async getStatus(): Promise<void> {
		const status = await this.qdrant.getStatus();
		console.log(JSON.stringify(status, null, 2));
	}

	/**
	 * Delete a repo from the index.
	 */
	async deleteRepo(repo: string): Promise<void> {
		await this.qdrant.deleteRepo(repo);
	}
}
