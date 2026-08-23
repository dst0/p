const WORK_PHASE_PATTERNS = [
  ["intake", /\b(?:baseline|begin|intake|resume|scope|start)\b/u],
  [
    "discovery",
    /\b(?:audit|diagnos(?:e|is|tic)|discover(?:y)?|inspect(?:ing|ion)?|investigat(?:e|ion)|read|review|search|trace)\b/u,
  ],
  ["planning", /\b(?:architect(?:ure)?|design|plan(?:ning)?|proposal|sequence|strategy)\b/u],
  [
    "implementation",
    /\b(?:build|chang(?:e|es|ing)|code|configur(?:e|ation)|creat(?:e|ing)|edit|fix|implement(?:ation|ing)?|modif(?:y|ication)|patch|refactor|remov(?:e|al)|writ(?:e|ing))\b/u,
  ],
  ["testing", /\b(?:coverage|jest|pytest|rspec|test(?:ing|s)?|vitest)\b/u],
  [
    "verification",
    /\b(?:benchmark|check(?:s|ing)?|ci|evidence|lint|smoke|typecheck|validat(?:e|ion)|verif(?:y|ication))\b/u,
  ],
  [
    "delivery",
    /\b(?:branch|changelog|commit|deploy(?:ment)?|merge|prs?|pull[ _-]?requests?|publish|push|releas(?:e|ed|es|ing)|version)\b/u,
  ],
  ["closure", /\b(?:clean[ -]?up|clos(?:e|ure)|finish|handoff|learning(?:s)?|report|summar(?:y|ize))\b/u],
];

export function inferBenchmarkProjectInstructionPhases(value) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en-US").replaceAll("_", " ");
  return WORK_PHASE_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([phase]) => phase);
}
