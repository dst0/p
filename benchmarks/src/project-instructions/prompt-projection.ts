import { createHash } from "node:crypto";
import { parseCompiledProjectInstructionMarker } from "./marker.ts";

const RULE_CATALOG_GUIDANCE = "Rule catalog: `rules/catalog.md`; use read_rules only with cataloged rules/* links.";
const LIST_SKILLS_GUIDANCE = "Use list_skills for bounded metadata-only skill discovery.";
const READ_SKILLS_GUIDANCE = "Use read_skills only with selected cataloged skills/* virtual links.";
const FALLBACK_PREFIX = "Only when neither logical reader is active, ordinary-read `";
const FALLBACK_SUFFIX =
  "` for authoritative source and physical catalog paths; never pass this path to read_rules or read_skills.";

export function computeAuthorizedProjectInstructionPromptHashes(canonicalPrompt: string): string[] | undefined {
  if (!parseCompiledProjectInstructionMarker(canonicalPrompt)) return undefined;
  const lines = canonicalPrompt.split("\n");
  if (
    [RULE_CATALOG_GUIDANCE, LIST_SKILLS_GUIDANCE, READ_SKILLS_GUIDANCE].some(
      (guidance) => lines.filter((line) => line === guidance).length !== 1,
    )
  ) {
    return undefined;
  }
  const fallbackLines = lines.filter((line) => line.startsWith(FALLBACK_PREFIX) && line.endsWith(FALLBACK_SUFFIX));
  if (fallbackLines.length !== 1 || fallbackLines[0].length <= FALLBACK_PREFIX.length + FALLBACK_SUFFIX.length) {
    return undefined;
  }
  const fallbackGuidance = fallbackLines[0];
  const hashes = new Set<string>();
  for (let mask = 0; mask < 16; mask += 1) {
    let prompt = canonicalPrompt;
    if ((mask & 1) === 0) prompt = removeGuidance(prompt, RULE_CATALOG_GUIDANCE);
    if ((mask & 2) === 0) prompt = removeGuidance(prompt, LIST_SKILLS_GUIDANCE);
    if ((mask & 4) === 0) prompt = removeGuidance(prompt, READ_SKILLS_GUIDANCE);
    if ((mask & 8) === 0 || (mask & 1) !== 0 || (mask & 4) !== 0) {
      prompt = removeGuidance(prompt, fallbackGuidance);
    }
    hashes.add(hashText(prompt));
  }
  return [...hashes].sort();
}

function removeGuidance(prompt: string, guidance: string): string {
  return prompt.replace(`\n${guidance}`, "");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
