import os from "node:os";
import path from "node:path";

import type { IndexConfig } from "./types.ts";

/** Default configuration values. */
export const DEFAULT_CONFIG: IndexConfig = {
	qdrantUrl: "http://localhost:6333",
	collection: "code_chunks",
	modelId: "Qwen/Qwen3-Embedding-0.6B",
	denseDim: 1024,
	workspace: path.join(os.homedir(), "dev"),
	bm25K1: 1.5,
	bm25B: 0.75,
	defaultChunkLines: 80,
	maxChunkLines: 300,
	maxFileSize: 2 * 1024 * 1024,
	batchSize: 2,
	encodeBatchSize: 1,
	maxEncodeChars: 2048,
	vocabPath: path.join(os.homedir(), ".local", "share", "qdrant", "bm25_vocab.json"),
	embeddingServerUrl: "http://127.0.0.1:18742",
};

/** Directories to exclude from indexing. */
export const EXCLUDE_DIRS: Set<string> = new Set([
	".git",
	"node_modules",
	"target",
	"dist",
	"build",
	".venv",
	"__pycache__",
	".cache",
	"egg-info",
	".tox",
	".mypy_cache",
	"vendor",
	"bower_components",
	".next",
	".nuxt",
	"out",
	"coverage",
	".pytest_cache",
	".idea",
	".vscode",
	".cargo",
	".svelte-kit",
	"pkg",
	"wasm",
	".wasm-pack",
	".tektonos",
	".tekton",
	".p",
	"tektonos",
	"storage",
	"data",
	"tmp",
	".yarn",
	"pnpm-store",
	".nx",
	".turbo",
	"site-packages",
	"dist-packages",
]);

/** File extensions to exclude. */
export const EXCLUDE_EXTS: Set<string> = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".ico",
	".svg",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".otf",
	".lock",
	".wasm",
	".so",
	".dylib",
	".dll",
	".a",
	".o",
	".zip",
	".tar",
	".gz",
	".bz2",
	".xz",
	".rar",
	".db",
	".sqlite",
	".sqlite3",
	".class",
	".pyc",
	".pyo",
	".min.js",
	".min.css",
	".snap",
	".fixture",
	".generated",
	".p12",
	".pfx",
	".jks",
]);

/** Map file extensions to language names. */
export const LANG_MAP: Record<string, string> = {
	".rs": "rust",
	".py": "python",
	".js": "javascript",
	".ts": "typescript",
	".tsx": "typescript",
	".jsx": "javascript",
	".go": "go",
	".java": "java",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".c": "c",
	".h": "c",
	".hpp": "cpp",
	".hxx": "cpp",
	".m": "objc",
	".swift": "swift",
	".kt": "kotlin",
	".scala": "scala",
	".rb": "ruby",
	".php": "php",
	".html": "html",
	".css": "css",
	".scss": "scss",
	".sass": "sass",
	".less": "less",
	".yaml": "yaml",
	".yml": "yaml",
	".json": "json",
	".toml": "toml",
	".ini": "ini",
	".cfg": "cfg",
	".conf": "conf",
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	".md": "markdown",
	".txt": "text",
	".latex": "latex",
	".sql": "sql",
	".graphql": "graphql",
	".gql": "graphql",
	".proto": "protobuf",
	".vue": "vue",
	".svelte": "svelte",
	".wgsl": "wgsl",
};

/**
 * Create configuration, optionally overriding defaults.
 * Only defined values from `overrides` are applied.
 */
export function createConfig(overrides: Partial<IndexConfig> = {}): IndexConfig {
	const filtered: Partial<IndexConfig> = {};
	for (const [key, value] of Object.entries(overrides)) {
		if (value !== undefined) {
			(filtered as Record<string, unknown>)[key] = value;
		}
	}
	return { ...DEFAULT_CONFIG, ...filtered };
}
