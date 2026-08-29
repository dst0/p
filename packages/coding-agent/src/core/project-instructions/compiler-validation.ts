import { requiresConservativeAlwaysOn } from "./compiler-scope.ts";
import {
  getProjectInstructionConstraintSourceText,
  materializeProjectInstructionAlwaysOn,
  materializeProjectInstructionBody,
  normalizeProjectInstructionSourceUnit,
} from "./compiler-source-units.ts";
import { parseProjectInstructionCompilerUsage } from "./compiler-usage.ts";
import { normalizeProjectInstructionModuleDependencies } from "./dependency-graph.ts";
import { PROJECT_INSTRUCTION_COMPILER_BODY_MAX_CHARS } from "./limits.ts";
import type {
  ProjectInstructionClassifications,
  ProjectInstructionCompilerResult,
  ProjectInstructionConstraintInput,
  ProjectInstructionModuleInput,
} from "./types.ts";

export { isUnmistakablyGlobalConstraint, requiresConservativeAlwaysOn } from "./compiler-scope.ts";

const NO_ALWAYS_ON_CONSTRAINTS = "No source constraints apply to every task.";
const ROUTING_METADATA_PATTERN =
  /\b(?:list_skills|read_rules|read_skills)\b|(?:^|[\s`(])(?:rules|skills)\/|\b(?:rules?|skills?)\s+(?:routes?|catalog)\b|\brout(?:e|ing)\s+(?:map|table)\b|\bmodule[- ]?(?:id|links?)\b|<\/?project_instructions\b|\[[^\]\r\n]+\]\([^)]+\)|https?:\/\/\S+|^\s*\|.+\|\s*$/imu;
const CONDITIONAL_ROUTE_PATTERN =
  /(?:\b(?:before|during|for|if|prior\s+to|when|whenever)\b[^\n.!?]{0,160}\b(?:consult|follow|inspect|load|open|read|retrieve|use)\b[^\n.!?]{0,100}\b(?:catalog|docs?|documentation|guidance|instructions?|modules?|playbooks?|polic(?:y|ies)|rules?)\b)|(?:\b(?:consult|follow|inspect|load|open|read|retrieve|use)\b[^\n.!?]{0,100}\b(?:catalog|docs?|documentation|guidance|instructions?|modules?|playbooks?|polic(?:y|ies)|rules?)\b[^\n.!?]{0,100}\b(?:before|during|prior\s+to|when|whenever)\b)/imu;
const ACTIVITY_STOP_WORDS = new Set([
  "a",
  "after",
  "all",
  "always",
  "an",
  "and",
  "any",
  "apply",
  "applies",
  "before",
  "by",
  "context",
  "detail",
  "details",
  "do",
  "does",
  "during",
  "every",
  "for",
  "from",
  "guidance",
  "if",
  "in",
  "instruction",
  "instructions",
  "into",
  "may",
  "must",
  "never",
  "not",
  "of",
  "on",
  "only",
  "or",
  "preserve",
  "prior",
  "request",
  "requested",
  "requests",
  "rule",
  "rules",
  "task",
  "tasks",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "turn",
  "turns",
  "unless",
  "when",
  "with",
  "without",
  "work",
  "working",
  "you",
]);

export function validateProjectInstructionCompilerResult(
  result: ProjectInstructionCompilerResult,
  modules: ProjectInstructionModuleInput[],
  constraints: ProjectInstructionConstraintInput[],
): ProjectInstructionCompilerResult {
  if (!result || typeof result.body !== "string") {
    throw new Error("Project instruction compiler returned an invalid body");
  }
  if (!isStringRecord(result.triggers)) {
    throw new Error("Project instruction compiler returned invalid triggers");
  }
  if (!isClassifications(result.classifications) || !isStringRecord(result.alwaysOn)) {
    throw new Error("Project instruction compiler returned incomplete classifications");
  }

  const moduleIds = modules.map((module) => module.id);
  const constraintIds = constraints.map((constraint) => constraint.id);
  assertExactKeys(result.classifications.modules, moduleIds, "module classifications");
  assertExactKeys(result.classifications.constraints, constraintIds, "constraint classifications");
  assertModuleClassifications(result.classifications, modules, constraints);
  const triggers = validateTriggers(result.triggers, moduleIds);
  const requires = normalizeProjectInstructionModuleDependencies(result.requires, modules);
  for (const moduleId of Object.keys(requires)) {
    const hasRoutedConstraint = constraints.some(
      (constraint) =>
        constraint.moduleId === moduleId && result.classifications.constraints[constraint.id] === "routed",
    );
    if (!hasRoutedConstraint) throw new Error(`Project instruction dependency owner is not routable: ${moduleId}`);
  }
  for (const constraint of constraints) {
    if (requiresConservativeAlwaysOn(constraint) && result.classifications.constraints[constraint.id] !== "always-on") {
      throw new Error(`Project instruction compiler routed an explicit always-on constraint: ${constraint.id}`);
    }
  }
  assertRoutedModulesHaveGroundedTriggers(result.classifications, modules, constraints, triggers);
  const alwaysOnIds = constraintIds.filter((id) => result.classifications.constraints[id] === "always-on");
  assertExactKeys(result.alwaysOn, alwaysOnIds, "always-on bodies");
  const expectedAlwaysOn = materializeProjectInstructionAlwaysOn(result.classifications, constraints);

  const alwaysOn: Record<string, string> = {};
  for (const id of alwaysOnIds) {
    const condensed = normalizeProjectInstructionSourceUnit(result.alwaysOn[id] ?? "");
    if (!condensed.trim()) throw new Error(`Project instruction compiler omitted always-on constraints for ${id}`);
    assertMeaningfulCondensation(id, expectedAlwaysOn[id], condensed);
    alwaysOn[id] = condensed;
  }
  const expectedBody = alwaysOnIds.length > 0 ? materializeProjectInstructionBody(alwaysOn) : NO_ALWAYS_ON_CONSTRAINTS;
  const body = normalizeProjectInstructionSourceUnit(result.body);
  if (body !== expectedBody) {
    throw new Error("Project instruction compiler body does not cover every always-on classification");
  }
  if (body.length > PROJECT_INSTRUCTION_COMPILER_BODY_MAX_CHARS) {
    throw new Error("Project instruction compiler body exceeds the always-on body budget");
  }
  if (ROUTING_METADATA_PATTERN.test(body) || CONDITIONAL_ROUTE_PATTERN.test(body)) {
    throw new Error("Project instruction compiler body contains routing metadata");
  }

  return {
    body,
    triggers,
    classifications: {
      modules: { ...result.classifications.modules },
      constraints: { ...result.classifications.constraints },
    },
    alwaysOn,
    ...(Object.keys(requires).length > 0 ? { requires } : {}),
    usage: validateCompilerUsage(result.usage),
  };
}

export function materializeProjectInstructionCompilerResult(
  classifications: ProjectInstructionClassifications,
  triggers: Record<string, string>,
  constraints: ProjectInstructionConstraintInput[],
  usage?: ProjectInstructionCompilerResult["usage"],
  requires?: ProjectInstructionCompilerResult["requires"],
): ProjectInstructionCompilerResult {
  const alwaysOn = materializeProjectInstructionAlwaysOn(classifications, constraints);
  const alwaysOnEntries = Object.entries(alwaysOn);
  return {
    body: alwaysOnEntries.length > 0 ? materializeProjectInstructionBody(alwaysOn) : NO_ALWAYS_ON_CONSTRAINTS,
    triggers,
    classifications,
    alwaysOn,
    ...(requires && Object.keys(requires).length > 0 ? { requires } : {}),
    usage,
  };
}

function assertExactKeys(record: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(record);
  if (actual.length !== expected.length || expected.some((id) => !Object.hasOwn(record, id))) {
    throw new Error(`Project instruction compiler returned incomplete ${label}`);
  }
}

function validateCompilerUsage(
  usage: ProjectInstructionCompilerResult["usage"],
): ProjectInstructionCompilerResult["usage"] {
  if (usage === undefined) return undefined;
  const validated = parseProjectInstructionCompilerUsage(usage, false);
  if (!validated) throw new Error("Project instruction compiler returned invalid usage");
  return validated;
}

function assertModuleClassifications(
  classifications: ProjectInstructionClassifications,
  modules: ProjectInstructionModuleInput[],
  constraints: ProjectInstructionConstraintInput[],
): void {
  for (const module of modules) {
    const moduleConstraints = constraints.filter((constraint) => constraint.moduleId === module.id);
    const containsAlwaysOn = moduleConstraints.some(
      (constraint) => classifications.constraints[constraint.id] === "always-on",
    );
    const expected = moduleConstraints.length === 0 || containsAlwaysOn ? "always-on" : "routed";
    if (classifications.modules[module.id] !== expected) {
      throw new Error(`Project instruction compiler returned an inconsistent classification for ${module.id}`);
    }
  }
}

function assertRoutedModulesHaveGroundedTriggers(
  classifications: ProjectInstructionClassifications,
  modules: ProjectInstructionModuleInput[],
  constraints: ProjectInstructionConstraintInput[],
  triggers: Record<string, string>,
): void {
  for (const module of modules) {
    const routedConstraints = constraints.filter(
      (constraint) => constraint.moduleId === module.id && classifications.constraints[constraint.id] === "routed",
    );
    if (routedConstraints.length === 0) continue;
    const trigger = triggers[module.id];
    const sourceTerms = new Set(
      routedConstraints.flatMap((constraint) =>
        tokenizeProjectInstructionActivity(getProjectInstructionConstraintSourceText(constraint)),
      ),
    );
    const triggerTerms = tokenizeProjectInstructionActivity(trigger ?? "");
    if (!trigger || !triggerTerms.some((term) => sourceTerms.has(term))) {
      throw new Error(`Project instruction compiler routed ${module.id} without a source-grounded trigger`);
    }
  }
}

export function tokenizeProjectInstructionActivity(content: string): string[] {
  return (
    content
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((token) => token.length >= 2 && /\p{L}/u.test(token) && !ACTIVITY_STOP_WORDS.has(token));
}

function validateTriggers(triggers: Record<string, string>, moduleIds: string[]): Record<string, string> {
  const moduleIdSet = new Set(moduleIds);
  const validated: Record<string, string> = {};
  for (const [id, trigger] of Object.entries(triggers)) {
    if (!moduleIdSet.has(id) || !isValidProjectInstructionTrigger(trigger)) {
      throw new Error(`Project instruction compiler returned an invalid trigger for ${id}`);
    }
    validated[id] = trigger;
  }
  return validated;
}

export function isValidProjectInstructionTrigger(trigger: string): boolean {
  return (
    Boolean(trigger) &&
    trigger === trigger.trim() &&
    [...trigger].length <= 500 &&
    !hasUnpairedSurrogate(trigger) &&
    !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(trigger)
  );
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertMeaningfulCondensation(id: string, expected: string | undefined, condensed: string): void {
  if (!expected || condensed.length < 4 || !/[\p{L}\p{N}]/u.test(condensed)) {
    throw new Error("Project instruction compiler returned a vacuous always-on condensation");
  }
  if (normalizeProjectInstructionSourceUnit(condensed) !== expected) {
    throw new Error(`Project instruction compiler did not preserve the source text for ${id}`);
  }
}
function isClassifications(value: unknown): value is ProjectInstructionClassifications {
  return isRecord(value) && isScopeRecord(value.modules) && isScopeRecord(value.constraints);
}
function isScopeRecord(value: unknown): value is Record<string, "always-on" | "routed"> {
  return isRecord(value) && Object.values(value).every((entry) => entry === "always-on" || entry === "routed");
}
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
