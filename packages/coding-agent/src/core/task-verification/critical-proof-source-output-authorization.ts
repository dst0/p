import {
  normalizeRequirementSourcePath,
  referencedRequirementCandidateCatalog,
} from "./referenced-requirement-sources.ts";

const SOURCE_OUTPUT_MARKER_PREFIX = "[source-output:";

export function sourceOutputAuthorizationMarker(sourcePath: string): string {
  return `${SOURCE_OUTPUT_MARKER_PREFIX}${sourcePath}]`;
}

export function sourceOutputAuthorizationIsBound(
  promptText: string,
  checklistCriterion: string,
  sourcePath: string,
): boolean {
  return (
    promptContainsSourceOutputAuthorization(promptText, sourcePath) &&
    textReferencesExactPath(checklistCriterion, sourcePath)
  );
}

export function promptContainsSourceOutputAuthorization(promptText: string, sourcePath: string): boolean {
  const promptMarkers = standaloneSourceOutputMarkers(promptText);
  return (
    promptMarkers !== undefined &&
    promptMarkers.filter((marker) => marker === sourcePath).length === 1 &&
    textReferencesExactPath(promptAuthorizationProse(promptText), sourcePath)
  );
}

function textReferencesExactPath(text: string, sourcePath: string): boolean {
  const catalog = referencedRequirementCandidateCatalog([{ id: "authorization", text }]);
  return !catalog.overflow && catalog.candidates.some((candidate) => candidate.path === sourcePath);
}

function standaloneSourceOutputMarkers(text: string): string[] | undefined {
  const markers: string[] = [];
  for (const line of topLevelLines(text)) {
    if (!line.startsWith(SOURCE_OUTPUT_MARKER_PREFIX)) continue;
    const match = /^\[source-output:([^\]]+)\]$/u.exec(line);
    const normalized = match ? normalizeRequirementSourcePath(match[1]!) : undefined;
    if (!match || normalized !== match[1]) return undefined;
    markers.push(normalized);
  }
  return new Set(markers).size === markers.length ? markers : undefined;
}

function promptAuthorizationProse(text: string): string {
  return topLevelLines(text)
    .filter((line) => !line.startsWith(SOURCE_OUTPUT_MARKER_PREFIX) && !/^ {0,3}>/u.test(line))
    .join("\n");
}

function topLevelLines(text: string): string[] {
  const lines: string[] = [];
  let fence: { character: string; length: number } | undefined;
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (fenceMatch?.[1]?.startsWith(fence.character.repeat(fence.length))) fence = undefined;
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = { character: fenceMatch[1][0]!, length: fenceMatch[1].length };
      continue;
    }
    lines.push(line);
  }
  return lines;
}
