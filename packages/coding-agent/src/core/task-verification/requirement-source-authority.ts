import type { TaskVerificationSourcePrompt } from "./types.ts";

interface RequirementSourceCandidateIdentity {
  path: string;
  referencedByPromptIds: string[];
}

const SOURCE_CUE_BEFORE_PATTERN =
  /(?:according\s+to|\bper\b|specified\s+by|defined\s+in|described\s+in|documented\s+in|(?:requirements?|specification|acceptance\s+criteria)\s+(?:in|from)|(?:read|review|follow|use|reference|consult)\s+(?:the\s+)?)\s*$/iu;
const SOURCE_CUE_AFTER_PATTERN = /^\s*(?:contains?|defines?|describes?|documents?|specifies?|lists?)\b/iu;
const OUTPUT_CUE_BEFORE_PATTERN =
  /(?:write|create|generate|save|emit|output|produce|append|update|edit)\b[^.!?\n]{0,80}(?:\b(?:to|into|in|at|as)\b\s*)?$/iu;
const OUTPUT_CUE_AFTER_PATTERN =
  /^\s*(?:as\s+)?(?:the\s+)?(?:output|deliverable|report|summary|notes?|documentation)\b/iu;

export function isAuthoritativeRequirementSourceCandidate(
  prompts: readonly TaskVerificationSourcePrompt[],
  candidate: RequirementSourceCandidateIdentity,
): boolean {
  const contexts = candidateContexts(prompts, candidate);
  if (
    contexts.some(({ before, after }) => SOURCE_CUE_BEFORE_PATTERN.test(before) || SOURCE_CUE_AFTER_PATTERN.test(after))
  ) {
    return true;
  }
  return contexts.some(({ before, after }) => !isOutputContext(before, after));
}

export function latestRequirementSourceDeauthorization(
  prompts: readonly TaskVerificationSourcePrompt[],
  path: string,
): TaskVerificationSourcePrompt | undefined {
  const latest = [...prompts].reverse().find((prompt) => prompt.kind !== "referenced_file");
  return latest && isExplicitRequirementSourceDeauthorization(latest.text, path) ? latest : undefined;
}

export function isExplicitRequirementSourceDeauthorization(prompt: string, path: string): boolean {
  const contexts = pathContexts(prompt, path);
  return contexts.some(({ before, after }) => {
    const stopsUsing =
      /(?:do\s+not|don't|dont|never|no\s+longer|stop|cease)\s+(?:using|use|following|follow|treating|treat)\s*$/iu.test(
        before,
      ) &&
      /^\s*(?:as\s+)?(?:an?\s+)?(?:authoritative\s+)?(?:requirement\s+source|specification|requirements?)\b/iu.test(
        after,
      );
    const removesFromSet =
      /(?:ignore|exclude|remove)\s*$/iu.test(before) &&
      /^\s*(?:as|from)\s+(?:the\s+)?(?:requirement\s+source|specification|requirements?|authoritative\s+sources?)\b/iu.test(
        after,
      );
    const declaresNonAuthority =
      /^\s*(?:is\s+)?(?:background\s+only|(?:is\s+)?(?:no\s+longer\s+|not\s+)(?:authoritative|a\s+requirement\s+source|the\s+specification))\b/iu.test(
        after,
      );
    return stopsUsing || removesFromSet || declaresNonAuthority;
  });
}

export function requirementSourceDeauthorizationIsCurrent(
  prompts: readonly TaskVerificationSourcePrompt[],
  path: string,
  promptId: string | undefined,
): boolean {
  const deauthorizationIndex = prompts.findIndex((prompt) => prompt.id === promptId);
  if (
    deauthorizationIndex < 0 ||
    !isExplicitRequirementSourceDeauthorization(prompts[deauthorizationIndex]!.text, path)
  ) {
    return false;
  }
  return !prompts.slice(deauthorizationIndex + 1).some(
    (prompt) =>
      prompt.kind !== "referenced_file" &&
      isAuthoritativeRequirementSourceCandidate(prompts, {
        path,
        referencedByPromptIds: [prompt.id],
      }),
  );
}

function candidateContexts(
  prompts: readonly TaskVerificationSourcePrompt[],
  candidate: RequirementSourceCandidateIdentity,
): Array<{ before: string; after: string }> {
  const promptIds = new Set(candidate.referencedByPromptIds);
  return prompts.flatMap((prompt) => (promptIds.has(prompt.id) ? pathContexts(prompt.text, candidate.path) : []));
}

function pathContexts(text: string, path: string): Array<{ before: string; after: string }> {
  const contexts: Array<{ before: string; after: string }> = [];
  const normalizedText = text.toLowerCase();
  const normalizedPath = path.toLowerCase();
  let offset = 0;
  while (offset < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedPath, offset);
    if (index < 0) break;
    contexts.push({
      before: normalizedText.slice(Math.max(0, index - 120), index),
      after: normalizedText.slice(index + normalizedPath.length, index + normalizedPath.length + 120),
    });
    offset = index + normalizedPath.length;
  }
  return contexts;
}

function isOutputContext(before: string, after: string): boolean {
  return OUTPUT_CUE_BEFORE_PATTERN.test(before) || OUTPUT_CUE_AFTER_PATTERN.test(after);
}
