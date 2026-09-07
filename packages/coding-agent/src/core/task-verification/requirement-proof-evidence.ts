import type { TaskRequirement } from "./types.ts";

export function selectorsMatchProofPolicies(requirement: TaskRequirement, selectors: readonly string[]): boolean {
  const text = selectors.join("\n");
  return (requirement.proofPolicies ?? []).every((policy) => {
    if (policy === "remove_exact_final_byte") {
      return (
        /\b(?:final|last|terminal)\b/iu.test(text) &&
        /\b(?:byte|character|newline)\b/iu.test(text) &&
        /\b(?:missing|remov\w*|truncat\w*)\b/iu.test(text)
      );
    }
    if (policy === "change_artifact_bytes") {
      return /\b(?:changed?|corrupt\w*|different|mutat\w*|tamper\w*)\b/iu.test(text);
    }
    if (policy === "preserve_state_on_failure") return rollbackSelector(text, /\bstate\b/iu);
    if (policy === "preserve_log_on_failure") return rollbackSelector(text, /\b(?:event[-\s]?logs?|history|logs?)\b/iu);
    if (policy === "preserve_version_on_failure") return rollbackSelector(text, /\bversions?\b/iu);
    if (policy === "preserve_position_on_failure") return rollbackSelector(text, /\bpositions?\b/iu);
    return rollbackSelector(text, /\b(?:command[-\s]?ids?|idempoten\w*)\b/iu);
  });
}

function rollbackSelector(value: string, observable: RegExp): boolean {
  return observable.test(value) && /\b(?:fail\w*|preserv\w*|rollback|unchanged)\b|\broll\w*\s+back\b/iu.test(value);
}
