#!/usr/bin/env node
/**
 * CLI entry point for code-index.
 *
 * Usage:
 *   code-index                          # full workspace reindex
 *   code-index --repo sophie-rs         # index single repo
 *   code-index --status                 # show index status
 *   code-index --delete-repo sophie-rs  # delete repo from index
 *   code-index --search "query"         # hybrid search
 *   code-index --workspace ~/projects   # custom workspace
 */

import fs from "node:fs";
import { createConfig } from "./config.ts";
import { findRepos } from "./discover.ts";
import type { EmbeddingProviderHttp } from "./embed/http.ts";
import { CodeIndexer } from "./indexer.ts";

interface CliArgs {
	repo?: string;
	status?: boolean;
	deleteRepo?: string;
	search?: string;
	workspace?: string;
	batchSize?: number;
	limit?: number;
	embeddingServerUrl?: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {};

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[i + 1];

		switch (arg) {
			case "--repo":
				args.repo = next();
				i++;
				break;
			case "--status":
				args.status = true;
				break;
			case "--delete-repo":
				args.deleteRepo = next();
				i++;
				break;
			case "--search":
				args.search = next();
				i++;
				break;
			case "--workspace":
				args.workspace = next();
				i++;
				break;
			case "--batch-size":
				args.batchSize = parseInt(next() ?? "64", 10);
				i++;
				break;
			case "--limit":
				args.limit = parseInt(next() ?? "10", 10);
				i++;
				break;
			case "--embedding-server":
				args.embeddingServerUrl = next();
				i++;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				console.error(`Unknown option: ${arg}`);
				printUsage();
				process.exit(1);
		}
	}

	return args;
}

function printUsage(): void {
	console.log(`
code-index — hybrid dense + BM25 code indexer

Usage:
  code-index                          Full workspace reindex
  code-index --repo <name>            Index a single repo
  code-index --status                 Show index status
  code-index --delete-repo <name>     Delete repo from index
  code-index --search "query"         Hybrid search
  code-index --workspace <path>       Custom workspace (default: ~/dev)

Options:
  --batch-size <n>                    Batch upload size (default: 64)
  --limit <n>                         Max search results (default: 10)
  --embedding-server <url>            Embedding server URL (default: http://127.0.0.1:18742)
  --help, -h                          Show this help message
`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	const config = createConfig({
		workspace: args.workspace,
		batchSize: args.batchSize,
		embeddingServerUrl: args.embeddingServerUrl,
	});

	const indexer = new CodeIndexer(config);

	// Register cleanup handler to stop the embedding server on exit
	const cleanup = () => {
		try {
			(indexer.encoder as EmbeddingProviderHttp).stop?.();
		} catch {
			/* ignore */
		}
		process.exit();
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
	process.on("exit", () => {
		try {
			(indexer.encoder as EmbeddingProviderHttp).stop?.();
		} catch {
			/* ignore */
		}
	});

	// Status — no model load needed
	if (args.status) {
		await indexer.getStatus();
		return;
	}

	// Delete repo — no model load needed
	if (args.deleteRepo) {
		await indexer.deleteRepo(args.deleteRepo);
		return;
	}

	// Load model for indexing/search
	await indexer.load();

	// Search
	if (args.search) {
		const hasVocab = await indexer.loadVocab();

		if (hasVocab) {
			await indexer.search(args.search, args.limit);
		} else {
			console.warn(`⚠️  BM25 vocabulary not found — using dense-only search.`);
			console.warn(`   Run an index pass first to build the vocabulary.`);
			await indexer.searchDense(args.search, args.limit);
		}
		return;
	}

	// Index single repo
	if (args.repo) {
		let repoPath = args.repo;

		if (!repoPath.startsWith("/")) {
			const testPath = `${config.workspace}/${repoPath}`;
			if (!fs.existsSync(testPath)) {
				console.error(`❌ Repo not found: ${repoPath}`);
				process.exit(1);
			}
			repoPath = testPath;
		}

		// Ensure collection exists
		try {
			await indexer.getStatus();
		} catch {
			console.log("Creating hybrid collection...");
			await indexer.qdrant.createCollection();
		}

		await indexer.indexRepo(repoPath);
		return;
	}

	// Full workspace reindex
	console.log("🗑️  Deleting old collection...");
	await indexer.qdrant.createCollection();

	const repos = findRepos(config.workspace);
	console.log(`\n📁 Found ${repos.length} repos in ${config.workspace}`);

	const totalStats = { files: 0, chunks: 0, skipped: 0, errors: 0 };
	const startTime = Date.now();

	for (const repoPath of repos) {
		const stats = await indexer.indexRepo(repoPath);
		totalStats.files += stats.files;
		totalStats.chunks += stats.chunks;
		totalStats.skipped += stats.skipped;
		totalStats.errors += stats.errors;
	}

	indexer.vocab.save(config.vocabPath);
	console.log(
		`\n💾 BM25 vocabulary saved to ${config.vocabPath} (${indexer.vocab.tokenToIdx.size} tokens, ${indexer.vocab.totalDocs} docs)`,
	);

	const elapsed = (Date.now() - startTime) / 1000;
	console.log(`\n${"=".repeat(60)}`);
	console.log(`✅ Index complete in ${elapsed.toFixed(1)}s`);
	console.log(`   Total: ${totalStats.files} files, ${totalStats.chunks} chunks`);
	console.log(`   Skipped: ${totalStats.skipped}, Errors: ${totalStats.errors}`);

	const status = await indexer.qdrant.getStatus();
	console.log(`   Qdrant points: ${status.points}`);
	console.log(`   Vector dim: ${status.vectorDim}`);
	console.log(`   Sparse vectors: ${status.sparseVectors}`);

	// Estimate disk usage
	const nPoints = totalStats.chunks;
	const denseBytes = nPoints * config.denseDim * 4;
	console.log(`\n💾 Storage estimate:`);
	console.log(`   Dense vectors:  ~${(denseBytes / 1024 / 1024).toFixed(0)} MB`);
	console.log(`   HNSW index:     ~${((denseBytes * 2.5) / 1024 / 1024).toFixed(0)} MB`);
	console.log(`   BM25 sparse:    ~${((nPoints * 50) / 1024).toFixed(0)} MB (estimated)`);
	console.log(`   Payload JSON:   ~${((nPoints * 300) / 1024 / 1024).toFixed(0)} MB`);
	console.log(`   Total disk:     ~${((denseBytes * 2.5 + nPoints * 350) / 1024 / 1024).toFixed(0)} MB`);
}

main().catch((e) => {
	console.error("Fatal:", e);
	process.exit(1);
});
