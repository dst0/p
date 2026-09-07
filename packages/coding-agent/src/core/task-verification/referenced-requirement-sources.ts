import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  isAuthoritativeRequirementSourceCandidate,
  latestRequirementSourceDeauthorization,
  requirementSourceDeauthorizationIsCurrent,
} from "./requirement-source-authority.ts";
import { inspectRequirementSourceFile } from "./requirement-source-file.ts";
import type {
  IgnoredTaskVerificationRequirementSource,
  TaskVerificationRequirementSourceRef,
  TaskVerificationSourcePrompt,
} from "./types.ts";

export const MAX_REQUIREMENT_SOURCE_CANDIDATES = 8;
export const MAX_SELECTED_REQUIREMENT_SOURCES = 3;
export const MAX_REQUIREMENT_SOURCE_BYTES = 12_288;
export const MAX_REQUIREMENT_SOURCE_TOTAL_BYTES = 24_576;
export const MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES = 32_768;

const MAX_REQUIREMENT_SOURCE_PATH_BYTES = 240;
const DOCUMENT_PATH_PATTERN = /(?:\.\/?|[\p{L}\p{N}_-])[\p{L}\p{N}_./-]*\.(?:adoc|md|mdx|rst|txt)\b/giu;
const TOKEN_BOUNDARY_PATTERN = /[\s`'"()[\]{}<>]/u;

export interface RequirementSourceCandidate {
  path: string;
  referencedByPromptIds: string[];
}

export interface RequirementSourceCandidateCatalog {
  candidates: RequirementSourceCandidate[];
  overflow: boolean;
  overflowCandidate?: RequirementSourceCandidate;
}

export interface IgnoredRequirementSourceCandidate {
  path: string;
  reason: string;
}

export interface PreparedRequirementSource {
  id: string;
  path: string;
  sha256: string;
  byteLength: number;
  referencedByPromptIds: string[];
  text: string;
}

export interface PreparedRequirementSourceSelection {
  selectedPaths: string[];
  sources: PreparedRequirementSource[];
  reusedReferences: TaskVerificationRequirementSourceRef[];
  ignoredSources: IgnoredTaskVerificationRequirementSource[];
}

export function referencedRequirementCandidates(
  prompts: readonly TaskVerificationSourcePrompt[],
): RequirementSourceCandidate[] {
  const catalog = referencedRequirementCandidateCatalog(prompts);
  return catalog.overflowCandidate ? [...catalog.candidates, catalog.overflowCandidate] : catalog.candidates;
}

export function referencedRequirementCandidateCatalog(
  prompts: readonly TaskVerificationSourcePrompt[],
): RequirementSourceCandidateCatalog {
  return boundedCandidateCatalog(extractRequirementSourceCandidates(prompts));
}

export function activeRequirementSourceCandidateCatalog(
  prompts: readonly TaskVerificationSourcePrompt[],
  acceptedDeauthorizedPaths: readonly string[] = [],
): RequirementSourceCandidateCatalog {
  const accepted = new Set(acceptedDeauthorizedPaths);
  const candidates = extractRequirementSourceCandidates(prompts).filter((candidate) => !accepted.has(candidate.path));
  return boundedCandidateCatalog(candidates);
}

export function requirementSourcePathReferencedByPrompt(prompt: TaskVerificationSourcePrompt, path: string): boolean {
  return extractRequirementSourceCandidates([prompt]).some((candidate) => candidate.path === path);
}

export function prepareReferencedRequirementSources(
  cwd: string,
  prompts: readonly TaskVerificationSourcePrompt[],
  selectedPaths: readonly string[],
  ignoredPaths: readonly IgnoredRequirementSourceCandidate[],
  reusableReferences: readonly TaskVerificationRequirementSourceRef[] = [],
  protectedPaths: readonly string[] = [],
): PreparedRequirementSourceSelection | string {
  const catalog = referencedRequirementCandidateCatalog(prompts);
  if (catalog.overflow) {
    return `More than ${MAX_REQUIREMENT_SOURCE_CANDIDATES} requirement-source candidates were referenced. Ask the user to narrow the authoritative specification set.`;
  }
  const candidates = catalog.candidates;
  const selectionError = validateSelection(candidates, prompts, selectedPaths, ignoredPaths, protectedPaths);
  if (selectionError) return selectionError;

  const normalizedSelected = selectedPaths.map((path) => normalizeRequirementSourcePath(path)!);
  const prepared: PreparedRequirementSource[] = [];
  const reused: TaskVerificationRequirementSourceRef[] = [];
  let totalBytes = 0;
  for (const selectedPath of normalizedSelected) {
    const candidate = candidates.find((item) => item.path === selectedPath)!;
    const reusable = reusableReferences.find((reference) => reference.path === selectedPath);
    if (reusable) {
      totalBytes += reusable.byteLength;
      reused.push(reusable);
    } else {
      const inspected = inspectRequirementSourceFile(cwd, selectedPath, MAX_REQUIREMENT_SOURCE_BYTES);
      if (typeof inspected === "string") return inspected;
      totalBytes += inspected.bytes.length;
      prepared.push({
        id: hashJson({ path: selectedPath, sha256: inspected.sha256, promptIds: candidate.referencedByPromptIds }),
        path: selectedPath,
        sha256: inspected.sha256,
        byteLength: inspected.bytes.length,
        referencedByPromptIds: candidate.referencedByPromptIds,
        text: inspected.text,
      });
    }
    if (totalBytes > MAX_REQUIREMENT_SOURCE_TOTAL_BYTES) {
      return `Selected requirement sources exceed the ${MAX_REQUIREMENT_SOURCE_TOTAL_BYTES}-byte total limit.`;
    }
  }
  return {
    selectedPaths: normalizedSelected,
    sources: prepared,
    reusedReferences: reused,
    ignoredSources: ignoredPaths.map((ignored) => {
      const path = candidates.find((item) => item.path === normalizeRequirementSourcePath(ignored.path))!.path;
      const deauthorization = latestRequirementSourceDeauthorization(prompts, path);
      return {
        path,
        reason: ignored.reason.trim(),
        ...(deauthorization ? { deauthorizedByPromptId: deauthorization.id } : {}),
      };
    }),
  };
}

export function preparedRequirementSourceMatches(
  cwd: string,
  reference: TaskVerificationRequirementSourceRef,
): boolean {
  const inspected = inspectRequirementSourceFile(cwd, reference.path, MAX_REQUIREMENT_SOURCE_BYTES);
  return typeof inspected !== "string" && inspected.sha256 === reference.sha256;
}

export function requirementSourceSelectionMatches(
  prompts: readonly TaskVerificationSourcePrompt[],
  references: readonly TaskVerificationRequirementSourceRef[],
  ignoredSources: readonly IgnoredTaskVerificationRequirementSource[],
): boolean {
  const catalog = referencedRequirementCandidateCatalog(prompts);
  if (catalog.overflow) return false;
  const sourceCandidates = catalog.candidates;
  const candidates = sourceCandidates.map((candidate) => candidate.path).sort();
  const classified = [
    ...references.map((reference) => reference.path),
    ...ignoredSources.map((item) => item.path),
  ].sort();
  const classificationMatches = candidates.every((path) => {
    const candidate = sourceCandidates.find((item) => item.path === path);
    const ignored = ignoredSources.find((item) => item.path === path);
    if (!candidate || !ignored || !isAuthoritativeRequirementSourceCandidate(prompts, candidate)) return true;
    return requirementSourceDeauthorizationIsCurrent(prompts, path, ignored.deauthorizedByPromptId);
  });
  return (
    candidates.length > 0 &&
    candidates.length === classified.length &&
    candidates.every((path, index) => path === classified[index]) &&
    new Set(classified).size === classified.length &&
    classificationMatches
  );
}

export function normalizeRequirementSourcePath(value: string): string | undefined {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    Buffer.byteLength(normalized) > MAX_REQUIREMENT_SOURCE_PATH_BYTES ||
    isAbsolute(normalized) ||
    /[\0*?[\]{}]/u.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return undefined;
  }
  return normalized;
}

export function isExplicitRequirementSourceAdoption(prompt: string, path: string): boolean {
  const normalizedPrompt = prompt.toLowerCase();
  const normalizedPath = path.toLowerCase();
  const pathIndex = normalizedPrompt.indexOf(normalizedPath);
  if (pathIndex < 0) return false;
  const context = normalizedPrompt.slice(Math.max(0, pathIndex - 100), pathIndex + normalizedPath.length + 100);
  if (/\b(?:do\s+not|don't|dont|never|without)\s+(?:adopt|accept|refresh|reload|re-read|reread|use)\b/u.test(context)) {
    return false;
  }
  const adoption = /\b(?:adopt|accept|refresh|reload|re-read|reread|use)\b/u.test(context);
  const changed = /\b(?:changed|current|latest|new|updated)\b/u.test(context);
  return adoption && changed;
}

function validateSelection(
  candidates: readonly RequirementSourceCandidate[],
  prompts: readonly TaskVerificationSourcePrompt[],
  selectedPaths: readonly string[],
  ignoredPaths: readonly IgnoredRequirementSourceCandidate[],
  protectedPaths: readonly string[],
): string | undefined {
  if (candidates.length === 0) return "No explicitly referenced requirement-source path was found.";
  if (selectedPaths.length > MAX_SELECTED_REQUIREMENT_SOURCES) {
    return `Select at most ${MAX_SELECTED_REQUIREMENT_SOURCES} requirement sources.`;
  }
  const selected = selectedPaths.map(normalizeRequirementSourcePath);
  const ignored = ignoredPaths.map((item) => normalizeRequirementSourcePath(item.path));
  if (selected.some((path) => !path) || ignored.some((path) => !path)) return "Requirement-source paths are invalid.";
  if (ignoredPaths.some((item) => !item.reason.trim())) return "Every ignored requirement source needs a reason.";
  const all = [...selected, ...ignored] as string[];
  if (new Set(all).size !== all.length) return "Each requirement-source candidate must be classified exactly once.";
  const candidatePaths = candidates.map((item) => item.path);
  const unknown = all.filter((path) => !candidatePaths.includes(path));
  const missing = candidatePaths.filter((path) => !all.includes(path));
  if (unknown.length > 0) return `Unknown requirement-source candidate: ${unknown.join(", ")}.`;
  if (missing.length > 0) return `Classify every requirement-source candidate: ${missing.join(", ")}.`;
  const protectedSet = new Set(
    protectedPaths.map(normalizeRequirementSourcePath).filter((path): path is string => !!path),
  );
  const unauthorized = ignored.filter((path): path is string => {
    if (!path) return false;
    const candidate = candidates.find((item) => item.path === path);
    const requiresAuthorization =
      protectedSet.has(path) || Boolean(candidate && isAuthoritativeRequirementSourceCandidate(prompts, candidate));
    return requiresAuthorization && !latestRequirementSourceDeauthorization(prompts, path);
  });
  if (unauthorized.length > 0) {
    return `Cannot ignore authoritative requirement source without explicit de-authorization in the latest direct user prompt: ${unauthorized.join(", ")}.`;
  }
  return undefined;
}

function isRemoteOrAbsoluteReference(text: string, matchIndex: number): boolean {
  let start = matchIndex;
  while (start > 0 && !TOKEN_BOUNDARY_PATTERN.test(text[start - 1]!)) start -= 1;
  let end = matchIndex;
  while (end < text.length && !TOKEN_BOUNDARY_PATTERN.test(text[end]!)) end += 1;
  const token = text.slice(start, end);
  return /:\/\//u.test(token) || token.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(token);
}

function extractRequirementSourceCandidates(
  prompts: readonly TaskVerificationSourcePrompt[],
): RequirementSourceCandidate[] {
  const candidates = new Map<string, string[]>();
  for (const prompt of prompts) {
    for (const match of prompt.text.matchAll(DOCUMENT_PATH_PATTERN)) {
      if (match.index === undefined || isRemoteOrAbsoluteReference(prompt.text, match.index)) continue;
      const normalized = normalizeRequirementSourcePath(match[0]);
      if (!normalized) continue;
      const promptIds = candidates.get(normalized) ?? [];
      if (!promptIds.includes(prompt.id)) promptIds.push(prompt.id);
      candidates.set(normalized, promptIds);
    }
  }
  return [...candidates].map(([path, referencedByPromptIds]) => ({ path, referencedByPromptIds }));
}

function boundedCandidateCatalog(candidates: RequirementSourceCandidate[]): RequirementSourceCandidateCatalog {
  return {
    candidates: candidates.slice(0, MAX_REQUIREMENT_SOURCE_CANDIDATES),
    overflow: candidates.length > MAX_REQUIREMENT_SOURCE_CANDIDATES,
    ...(candidates[MAX_REQUIREMENT_SOURCE_CANDIDATES]
      ? { overflowCandidate: candidates[MAX_REQUIREMENT_SOURCE_CANDIDATES] }
      : {}),
  };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
