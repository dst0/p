import fs from "node:fs";
import path from "node:path";
import type { IndexManifest } from "./types.ts";

export const INDEX_MANIFEST_SCHEMA_VERSION = 1;
export const CHUNKER_NAME = "p-symbol-lines";
export const CHUNKER_VERSION = "1";

function isManifest(value: unknown): value is IndexManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Partial<IndexManifest>;
	return (
		candidate.schemaVersion === INDEX_MANIFEST_SCHEMA_VERSION &&
		typeof candidate.repoId === "string" &&
		typeof candidate.root === "string" &&
		typeof candidate.collection === "string" &&
		typeof candidate.generation === "string" &&
		candidate.files !== undefined &&
		typeof candidate.files === "object" &&
		candidate.chunker?.name === CHUNKER_NAME &&
		typeof candidate.chunker.version === "string" &&
		typeof candidate.embedding?.dimensions === "number" &&
		candidate.sparse?.strategy === "frozen-bm25"
	);
}

export function loadManifest(manifestPath: string): IndexManifest | undefined {
	if (!fs.existsSync(manifestPath)) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to read code RAG manifest: ${message}`);
	}
	if (!isManifest(value)) {
		throw new Error("Code RAG manifest is incompatible or malformed");
	}
	return value;
}

export function writeManifestAtomic(manifestPath: string, manifest: IndexManifest): void {
	const directory = path.dirname(manifestPath);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
	const file = fs.openSync(temporaryPath, "w", 0o600);
	try {
		fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
		fs.fsyncSync(file);
	} finally {
		fs.closeSync(file);
	}
	fs.renameSync(temporaryPath, manifestPath);
}

export interface RepositoryLock {
	release(): void;
}

export function acquireRepositoryLock(directory: string, staleAfterMs: number = 10 * 60_000): RepositoryLock {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const lockPath = path.join(directory, "refresh.lock");
	try {
		const stat = fs.statSync(lockPath);
		if (Date.now() - stat.mtimeMs > staleAfterMs) fs.unlinkSync(lockPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}

	let file: number;
	try {
		file = fs.openSync(lockPath, "wx", 0o600);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			throw new Error("A code RAG refresh is already running for this workspace");
		}
		throw error;
	}
	fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
	fs.closeSync(file);

	let released = false;
	return {
		release() {
			if (released) return;
			released = true;
			try {
				fs.unlinkSync(lockPath);
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			}
		},
	};
}
