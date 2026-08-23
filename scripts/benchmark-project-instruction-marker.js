const PROJECT_INSTRUCTION_START_PATTERN = /<project_instructions\b/gu;
const PROJECT_INSTRUCTION_OPENING_PATTERN = /<project_instructions\b[^>\n]*>/gu;
const PROJECT_INSTRUCTION_CLOSING_PATTERN = /<\/project_instructions>/gu;
const ATTRIBUTE_PATTERN = /([a-z_][a-z0-9_]*)="([^"\n]*)"/gu;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MODES = new Set(["compiled", "exact", "fallback"]);
const REQUIRED_ATTRIBUTES = new Set(["agents_sha256", "input_sha256", "mode"]);

export function parseCompiledProjectInstructionMarker(value) {
  if (typeof value !== "string") return undefined;
  const starts = [...value.matchAll(PROJECT_INSTRUCTION_START_PATTERN)];
  const openings = [...value.matchAll(PROJECT_INSTRUCTION_OPENING_PATTERN)];
  const closings = [...value.matchAll(PROJECT_INSTRUCTION_CLOSING_PATTERN)];
  if (
    starts.length !== 1 ||
    openings.length !== 1 ||
    closings.length !== 1 ||
    starts[0].index !== openings[0].index ||
    closings[0].index < openings[0].index + openings[0][0].length
  ) {
    return undefined;
  }
  const opening = openings[0][0];
  const attributesText = opening.slice("<project_instructions ".length, -1);
  const matches = [...attributesText.matchAll(ATTRIBUTE_PATTERN)];
  if (matches.length !== REQUIRED_ATTRIBUTES.size || matches.map((match) => match[0]).join(" ") !== attributesText) {
    return undefined;
  }
  const attributes = new Map(matches.map((match) => [match[1], match[2]]));
  if (
    attributes.size !== REQUIRED_ATTRIBUTES.size ||
    [...attributes.keys()].some((name) => !REQUIRED_ATTRIBUTES.has(name))
  ) {
    return undefined;
  }
  const agentsSha256 = attributes.get("agents_sha256");
  const inputSha256 = attributes.get("input_sha256");
  const mode = attributes.get("mode");
  if (!HASH_PATTERN.test(agentsSha256 ?? "") || !HASH_PATTERN.test(inputSha256 ?? "") || !MODES.has(mode)) {
    return undefined;
  }
  return { agentsSha256, inputSha256, mode };
}
