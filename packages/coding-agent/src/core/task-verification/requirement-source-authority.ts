import type { TaskVerificationSourcePrompt } from "./types.ts";

interface RequirementSourceCandidateIdentity {
  path: string;
  referencedByPromptIds: string[];
}

const SOURCE_CUE_BEFORE_PATTERN =
  /(?:according\s+to|\bper\b|specified\s+by|defined\s+in|described\s+in|documented\s+in|(?:requirements?|specification|acceptance\s+criteria|contract)\s+(?:in|from)|(?:read|review|follow|use|reference|consult|treat)\s+(?:the\s+)?)\s*$/iu;
const SOURCE_LIST_CUE_BEFORE_PATTERN =
  /(?:according\s+to|\bper\b|specified\s+by|defined\s+in|described\s+in|documented\s+in|(?:requirements?|specifications?|acceptance\s+criteria|contracts?)\s+(?:in|from)|(?:read|review|follow|use|reference|consult)\s+(?:the\s+)?)(?:\s+|,\s*|[^,\s]+\.(?:adoc|md|mdx|rst|txt))*$/iu;
const SOURCE_CUE_AFTER_PATTERN =
  /^\s*(?:(?:contains?|defines?|describes?|documents?|specifies?|lists?)\b|as\s+(?:an?\s+|the\s+)?(?:authoritative\s+)?(?:requirement\s+source|specification|requirements?)\b|is\s+(?:an?\s+|the\s+)?(?:authoritative\s+)?(?:requirement\s+source|specification|requirements?)\b)/iu;
const EXPLICIT_REAUTHORIZATION_BEFORE_PATTERN =
  /(?:^|[.!?]\s+)(?:please\s+)?(?:actually\s+)?(?:(?:adopt|accept|follow|use|consult|read|review)\s+(?:the\s+)?|(?:implement|build|change|fix|update)\b[^.!?\n]{0,100}(?:according\s+to|\bper\b|specified\s+by|defined\s+in|described\s+in|documented\s+in|requirements?\s+(?:in|from))\s*)$/iu;
const EXPLICIT_REAUTHORIZATION_AFTER_PATTERN =
  /^\s*(?:is|must\s+be|should\s+be|shall\s+be)\s+(?:again\s+)?(?:an?\s+|the\s+)?(?:authoritative\s+)?(?:requirement\s+source|specification|requirements?)\b/iu;

export function isAuthoritativeRequirementSourceCandidate(
  prompts: readonly TaskVerificationSourcePrompt[],
  candidate: RequirementSourceCandidateIdentity,
): boolean {
  const contexts = candidateContexts(prompts, candidate);
  return contexts.some(
    ({ before, after }) =>
      SOURCE_CUE_BEFORE_PATTERN.test(before) ||
      SOURCE_LIST_CUE_BEFORE_PATTERN.test(before) ||
      SOURCE_CUE_AFTER_PATTERN.test(after),
  );
}

export function latestRequirementSourceDeauthorization(
  prompts: readonly TaskVerificationSourcePrompt[],
  path: string,
): TaskVerificationSourcePrompt | undefined {
  return [...prompts]
    .reverse()
    .find(
      (prompt) =>
        prompt.kind !== "referenced_file" &&
        isExplicitRequirementSourceDeauthorization(prompt.text, path) &&
        requirementSourceDeauthorizationIsCurrent(prompts, path, prompt.id),
    );
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
  return !prompts
    .slice(deauthorizationIndex + 1)
    .some(
      (prompt) => prompt.kind !== "referenced_file" && isExplicitRequirementSourceReauthorization(prompt.text, path),
    );
}

function isExplicitRequirementSourceReauthorization(prompt: string, path: string): boolean {
  return pathContexts(prompt, path).some(
    ({ before, after }) =>
      EXPLICIT_REAUTHORIZATION_BEFORE_PATTERN.test(before) || EXPLICIT_REAUTHORIZATION_AFTER_PATTERN.test(after),
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
