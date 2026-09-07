import { PROJECT_INSTRUCTION_RULE_EXPANSION_MAX_MODULES } from "./limits.ts";
import type { ProjectInstructionModuleInput, ProjectInstructionRuleRecord } from "./types.ts";

const MAX_EXPLICIT_RULE_LINKS = 3;

export function validateProjectInstructionRuleDependencies(rules: ProjectInstructionRuleRecord[]): void {
  const byLink = new Map<string, ProjectInstructionRuleRecord>();
  for (const rule of rules) {
    if (!isRuleLink(rule.link)) throw new Error(`Invalid rule link in dependency graph: ${rule.link}`);
    if (byLink.has(rule.link)) throw new Error(`Duplicate rule link in dependency graph: ${rule.link}`);
    byLink.set(rule.link, rule);
    if (rule.requires !== undefined && !isStringArray(rule.requires)) {
      throw new Error(`Invalid dependency list for ${rule.link}`);
    }
  }
  for (const rule of rules) {
    for (const dependency of rule.requires ?? []) {
      if (!isRuleLink(dependency)) throw new Error(`Invalid dependency link for ${rule.link}: ${dependency}`);
      if (!byLink.has(dependency)) {
        throw new Error(`Rule dependency graph has missing dependency ${dependency} required by ${rule.link}`);
      }
    }
  }
  assertAcyclic([...byLink.keys()], (link) => byLink.get(link)?.requires ?? [], "Rule dependency cycle");
}

export function expandProjectInstructionRuleLinks(
  rules: ProjectInstructionRuleRecord[],
  selectedLinks: string[],
): string[] {
  if (selectedLinks.length === 0) throw new Error("read_rules requires at least one explicitly selected link");
  if (selectedLinks.length > MAX_EXPLICIT_RULE_LINKS) {
    throw new Error(`read_rules accepts at most ${MAX_EXPLICIT_RULE_LINKS} explicitly selected links`);
  }
  validateProjectInstructionRuleDependencies(rules);
  const byLink = new Map(rules.map((rule) => [rule.link, rule]));
  const expanded: string[] = [];
  const state = new Map<string, "visiting" | "complete">();
  let moduleCount = 0;
  for (const selected of selectedLinks) {
    const pending: Array<{ link: string; emit: boolean }> = [{ link: selected, emit: false }];
    while (pending.length > 0) {
      const item = pending.pop();
      if (!item || state.get(item.link) === "complete") continue;
      const rule = byLink.get(item.link);
      if (!rule) {
        state.set(item.link, "complete");
        expanded.push(item.link);
        continue;
      }
      if (item.emit) {
        state.set(item.link, "complete");
        expanded.push(item.link);
        continue;
      }
      if (state.get(item.link) === "visiting") continue;
      state.set(item.link, "visiting");
      moduleCount += 1;
      if (moduleCount > PROJECT_INSTRUCTION_RULE_EXPANSION_MAX_MODULES) {
        throw new Error(
          `Rule dependency expansion exceeds the ${PROJECT_INSTRUCTION_RULE_EXPANSION_MAX_MODULES}-module limit`,
        );
      }
      pending.push({ link: item.link, emit: true });
      for (const dependency of [...(rule.requires ?? [])].reverse()) {
        pending.push({ link: dependency, emit: false });
      }
    }
  }
  return expanded;
}

export function normalizeProjectInstructionModuleDependencies(
  value: unknown,
  modules: ProjectInstructionModuleInput[],
): Record<string, string[]> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Project instruction compiler returned invalid module dependencies");
  const moduleOrder = new Map(modules.map((module, index) => [module.id, index]));
  const normalized: Record<string, string[]> = {};
  for (const moduleId of Object.keys(value)) {
    if (!moduleOrder.has(moduleId)) {
      throw new Error(`Project instruction compiler returned dependency metadata for unknown module ${moduleId}`);
    }
  }
  for (const module of modules) {
    const dependencies = value[module.id];
    if (dependencies === undefined) continue;
    if (!isStringArray(dependencies)) {
      throw new Error(`Project instruction compiler returned invalid dependencies for ${module.id}`);
    }
    const unique = [...new Set(dependencies)];
    for (const dependency of unique) {
      if (!moduleOrder.has(dependency)) {
        throw new Error(`Project instruction compiler returned missing module dependency ${dependency}`);
      }
    }
    if (unique.length > 0) {
      normalized[module.id] = unique.sort((left, right) => moduleOrder.get(left)! - moduleOrder.get(right)!);
    }
  }
  assertAcyclic(
    modules.map((module) => module.id),
    (moduleId) => normalized[moduleId] ?? [],
    "Project instruction module dependency cycle",
  );
  return normalized;
}

function assertAcyclic(nodes: string[], dependencies: (node: string) => string[], label: string): void {
  const complete = new Set<string>();
  const active = new Set<string>();
  for (const root of nodes) {
    if (complete.has(root)) continue;
    const stack: Array<{ node: string; dependencyIndex: number }> = [{ node: root, dependencyIndex: 0 }];
    active.add(root);
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (!frame) break;
      const next = dependencies(frame.node)[frame.dependencyIndex];
      if (next === undefined) {
        stack.pop();
        active.delete(frame.node);
        complete.add(frame.node);
        continue;
      }
      frame.dependencyIndex += 1;
      if (complete.has(next)) continue;
      if (active.has(next)) {
        const path = stack.map(({ node }) => node);
        const start = path.indexOf(next);
        throw new Error(`${label}: ${[...path.slice(start), next].join(" -> ")}`);
      }
      active.add(next);
      stack.push({ node: next, dependencyIndex: 0 });
    }
  }
}

function isRuleLink(link: string): boolean {
  return /^rules\/[a-z0-9][a-z0-9-]*\.md$/u.test(link);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
