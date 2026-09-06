const REJECT_PATTERN = /\b(?:block\w*|den(?:y|ies|ied|ying)|fail\w*|reject\w*|throw\w*)\b/iu;
const ACCEPT_PATTERN = /\b(?:accept\w*|allow\w*|permit\w*)\b/iu;
const PRESERVE_PATTERN = /\b(?:include\w*|keep\w*|preserv\w*|retain\w*|same|unchanged)\b|\bend\w*\s+with\b/iu;
const REMOVE_PATTERN = /\b(?:different|discard\w*|drop\w*|missing|new|omit\w*|remov\w*|replac\w*|without)\b/iu;
const REQUIRE_PATTERN = /\b(?:mandatory|must|need\w*|requir\w*|shall)\b/iu;
const OPTIONAL_PATTERN = /\b(?:may|optional|optionally)\b/iu;
const NEGATED_REJECT_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:block|deny|fail|reject|throw)\w*\b/iu;
const NEGATED_ACCEPT_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:accept|allow|permit)\w*\b/iu;
const NEGATED_PRESERVE_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:include|keep|preserve|retain)\w*\b/iu;
const NEGATED_REMOVE_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:discard|drop|omit|remove|replace)\w*\b|\bwithout\s+(?:(?:any|partial)\s+)?(?:alter\w*|chang\w*|corrupt\w*|delet\w*|discard\w*|drop\w*|mutat\w*|remov\w*|replac\w*)\b/iu;
const NEGATED_REQUIRE_PATTERN =
  /\b(?:do\s+not|don't|dont|never|no\s+longer|not\s+to)\s+(?:\w+\s+){0,2}(?:need|require)\w*\b/iu;
const EXPLICIT_REQUIREMENT_PREDICATE_PATTERN =
  /\b(?:(?:are|be|become\w*|is|remain\w*|was|were)\s+(?:mandatory|optional|required)|requires?)\b/iu;

interface BehaviorPolarity {
  reject: boolean;
  accept: boolean;
  preserve: boolean;
  remove: boolean;
  require: boolean;
  optional: boolean;
}

const REQUIRED_BEHAVIOR_PAIRS = [
  ["reject", "accept"],
  ["preserve", "remove"],
] as const satisfies ReadonlyArray<readonly [keyof BehaviorPolarity, keyof BehaviorPolarity]>;
const REQUIRED_MODAL_PAIR = ["require", "optional"] as const;

export function behavioralPolaritiesConflict(left: string, right: string): boolean {
  return polaritiesConflict(behaviorPolarity(left), behaviorPolarity(right));
}

export function behavioralPolaritiesAgree(left: string, right: string): boolean {
  const leftPolarity = behaviorPolarity(left);
  const rightPolarity = behaviorPolarity(right);
  return (Object.keys(leftPolarity) as Array<keyof BehaviorPolarity>).some(
    (key) => leftPolarity[key] && rightPolarity[key],
  );
}

export function retainsRequiredBehaviorPolarity(source: string, relatedCandidates: readonly string[]): boolean {
  const sourcePolarity = behaviorPolarity(source);
  const candidatePolarities = relatedCandidates.map(behaviorPolarity);
  const concretePairs = REQUIRED_BEHAVIOR_PAIRS.filter(
    ([positive, negative]) => sourcePolarity[positive] || sourcePolarity[negative],
  );
  if (concretePairs.length > 0) {
    return concretePairs.every(([positive, negative]) => {
      if (sourcePolarity[positive] && sourcePolarity[negative]) {
        return (
          candidatePolarities.some((candidate) => candidate[positive]) &&
          candidatePolarities.some((candidate) => candidate[negative])
        );
      }
      const expected = sourcePolarity[positive] ? positive : negative;
      const opposite = sourcePolarity[positive] ? negative : positive;
      return candidatePolarities.some((candidate) => candidate[expected] && !candidate[opposite]);
    });
  }
  if (sourcePolarity.require === sourcePolarity.optional || !EXPLICIT_REQUIREMENT_PREDICATE_PATTERN.test(source)) {
    return true;
  }
  const [positive, negative] = REQUIRED_MODAL_PAIR;
  const expected = sourcePolarity[positive] ? positive : negative;
  const opposite = sourcePolarity[positive] ? negative : positive;
  return candidatePolarities.some((candidate) => candidate[expected] && !candidate[opposite]);
}

function behaviorPolarity(value: string): BehaviorPolarity {
  const negatedReject = NEGATED_REJECT_PATTERN.test(value);
  const negatedAccept = NEGATED_ACCEPT_PATTERN.test(value);
  const negatedPreserve = NEGATED_PRESERVE_PATTERN.test(value);
  const negatedRemove = NEGATED_REMOVE_PATTERN.test(value);
  const negatedRequire = NEGATED_REQUIRE_PATTERN.test(value);
  return {
    reject: negatedAccept || (REJECT_PATTERN.test(value) && !negatedReject),
    accept: negatedReject || (ACCEPT_PATTERN.test(value) && !negatedAccept),
    preserve: negatedRemove || (PRESERVE_PATTERN.test(value) && !negatedPreserve),
    remove: negatedPreserve || (REMOVE_PATTERN.test(value) && !negatedRemove),
    require: REQUIRE_PATTERN.test(value) && !negatedRequire,
    optional: negatedRequire || OPTIONAL_PATTERN.test(value),
  };
}

function polaritiesConflict(left: BehaviorPolarity, right: BehaviorPolarity): boolean {
  return (
    polarityPairConflicts(left, right, "reject", "accept") ||
    polarityPairConflicts(left, right, "preserve", "remove") ||
    polarityPairConflicts(left, right, "require", "optional")
  );
}

function polarityPairConflicts(
  left: BehaviorPolarity,
  right: BehaviorPolarity,
  positive: keyof BehaviorPolarity,
  negative: keyof BehaviorPolarity,
): boolean {
  return (
    (left[positive] && !left[negative] && right[negative] && !right[positive]) ||
    (left[negative] && !left[positive] && right[positive] && !right[negative])
  );
}
