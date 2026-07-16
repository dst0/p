import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StructuredSessionState } from "./structured-state.ts";

const STATE_DIR = ".pdev/state";
const STATE_FILE_EXT = ".json";

/**
 * Resolve the per-session state file path: .pdev/state/<sessionId>.json
 */
export function getSessionStateFilePath(cwd: string, sessionId: string): string {
	return join(cwd, STATE_DIR, `${sessionId}${STATE_FILE_EXT}`);
}

/**
 * Read the structured session state from the dedicated state file.
 * Returns undefined if the file does not exist or contains invalid JSON.
 */
export function readSessionStateFile(cwd: string, sessionId: string): StructuredSessionState | undefined {
	const path = getSessionStateFilePath(cwd, sessionId);
	if (!existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw);
		if (isStructuredSessionState(parsed)) {
			return parsed;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Write the structured session state to the dedicated state file.
 * Creates the .pdev/state directory if it does not exist.
 */
export function writeSessionStateFile(cwd: string, state: StructuredSessionState): void {
	const path = getSessionStateFilePath(cwd, state.sessionId);
	mkdirSync(join(cwd, STATE_DIR), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, undefined, 2)}\n`);
}

/**
 * Type guard for StructuredSessionState from raw JSON.
 */
function isStructuredSessionState(value: unknown): value is StructuredSessionState {
	if (!value || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.version === "number" &&
		typeof obj.sessionId === "string" &&
		typeof obj.canonicalRequest === "object" &&
		Array.isArray(obj.plan)
	);
}
