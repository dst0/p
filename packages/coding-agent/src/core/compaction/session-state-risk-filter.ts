import type { SessionEntry } from "../session-manager.ts";
import {
	createLiveStructuredSessionState as createLiveStructuredSessionStateRaw,
	createStructuredSessionState as createStructuredSessionStateRaw,
	getLatestStructuredSessionState as getLatestStructuredSessionStateRaw,
	hasMeaningfulStructuredSessionState as hasMeaningfulStructuredSessionStateRaw,
	type LiveStructuredStateInput,
	mergeStructuredSessionState as mergeStructuredSessionStateRaw,
	renderStructuredSessionCheckpoint as renderStructuredSessionCheckpointRaw,
	renderWorkingSessionState as renderWorkingSessionStateRaw,
	type StatePatch,
	type StructuredSessionState,
	type StructuredStateUpdateInput,
} from "./structured-state.ts";

const IGNORED_SESSION_STATE_RISK_PREFIXES = ["post-compaction context exceeds target"] as const;

function isIgnoredSessionStateRisk(risk: string): boolean {
	const normalized = risk.trim().replace(/\s+/g, " ").toLowerCase();
	return IGNORED_SESSION_STATE_RISK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Remove internal diagnostics that are not actionable session risks. */
export function sanitizeStructuredSessionState(state: StructuredSessionState): StructuredSessionState {
	const knownRisks = (state.audit.knownRisks ?? []).filter((risk) => !isIgnoredSessionStateRisk(risk));
	if (knownRisks.length === state.audit.knownRisks.length) {
		return state;
	}
	return {
		...state,
		audit: {
			...state.audit,
			knownRisks,
		},
	};
}

export function createStructuredSessionState(input: StructuredStateUpdateInput): StructuredSessionState {
	return sanitizeStructuredSessionState(createStructuredSessionStateRaw(input));
}

export function createLiveStructuredSessionState(input: LiveStructuredStateInput): StructuredSessionState {
	return sanitizeStructuredSessionState(createLiveStructuredSessionStateRaw(input));
}

export function mergeStructuredSessionState(
	previous: StructuredSessionState,
	patch: StatePatch,
): StructuredSessionState {
	return sanitizeStructuredSessionState(mergeStructuredSessionStateRaw(previous, patch));
}

export function getLatestStructuredSessionState(entries: SessionEntry[]): StructuredSessionState | undefined {
	const state = getLatestStructuredSessionStateRaw(entries);
	return state ? sanitizeStructuredSessionState(state) : undefined;
}

export function renderStructuredSessionCheckpoint(state: StructuredSessionState, maxTokens: number): string {
	return renderStructuredSessionCheckpointRaw(sanitizeStructuredSessionState(state), maxTokens);
}

export function renderWorkingSessionState(state: StructuredSessionState, maxTokens: number): string | undefined {
	return renderWorkingSessionStateRaw(sanitizeStructuredSessionState(state), maxTokens);
}

export function hasMeaningfulStructuredSessionState(state: StructuredSessionState): boolean {
	return hasMeaningfulStructuredSessionStateRaw(sanitizeStructuredSessionState(state));
}
