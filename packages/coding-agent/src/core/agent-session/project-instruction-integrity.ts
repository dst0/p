import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import type { ProjectInstructionDeliveryMode } from "../project-instructions/index.ts";
import type { SessionEntry, SessionManager } from "../session-manager.ts";
import { RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE } from "./constants.ts";
import { isRecord } from "./message-utils.ts";
import { MAX_PROJECT_RULE_LINKS_PER_TURN, type ProjectRuleGate } from "./state-types.ts";

export const PROJECT_RULE_RECEIPT_CUSTOM_TYPE = "project_rule_receipt";
export const PROJECT_RULE_BATCH_CUSTOM_TYPE = "project_rule_batch";
export const PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE = "project_rule_supersession";

const PROJECT_INSTRUCTION_BLOCK_TAGS = [
  "project_context",
  "project_instructions",
  "project_rule_routes",
  "project_rules",
] as const;

const RUNTIME_ALLOWED_TAGS: Record<ProjectInstructionDeliveryMode, ReadonlySet<string>> = {
  compiled: new Set(["project_rule_routes"]),
  legacy: new Set(["project_rules"]),
  off: new Set(),
};

export function preserveCompiledProjectInstructionPrompt(
  candidatePrompt: string,
  immutablePrompt: string | undefined,
): string {
  if (!immutablePrompt) return candidatePrompt;
  const withoutProjectInstructions = stripProjectInstructionBlocks(candidatePrompt, new Set()).trimEnd();
  return withoutProjectInstructions ? `${withoutProjectInstructions}\n\n${immutablePrompt}` : immutablePrompt;
}

export function filterProjectInstructionHistory(
  messages: AgentMessage[],
  mode: ProjectInstructionDeliveryMode,
): AgentMessage[] {
  const compatible: AgentMessage[] = [];
  for (const message of messages) {
    if (message.role === "compactionSummary" || message.role === "branchSummary") {
      const summary = stripProjectInstructionBlocks(message.summary, new Set());
      compatible.push(summary === message.summary ? message : { ...message, summary });
      continue;
    }
    if (message.role !== "custom" || message.customType !== RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE) {
      compatible.push(message);
      continue;
    }
    const content = stripProjectInstructionContent(message.content, RUNTIME_ALLOWED_TAGS[mode]);
    if (!isEmptyProjectInstructionContent(content)) {
      compatible.push(content === message.content ? message : { ...message, content });
    }
  }
  return compatible;
}

export function restoreProjectRuleGateFromHistory(
  entries: SessionEntry[],
  currentInputHash: string,
  nextGeneration: () => number,
): ProjectRuleGate | undefined {
  const pending: Array<{ inputHash: string; links: string[] }> = [];
  let candidateLinks: string[] = [];
  let failure: string | undefined;
  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      if (containsProjectRuleRoutes(entry.summary)) failure = unverifiableRestoredGateReason();
      continue;
    }
    if (entry.type === "custom" && entry.customType === PROJECT_RULE_RECEIPT_CUSTOM_TYPE) {
      const receipt = deserializeProjectRuleReceipt(entry.data);
      if (!receipt) {
        failure = unverifiableRestoredGateReason();
        continue;
      }
      const matchingIndex = pending.findIndex(
        (batch) => batch.inputHash === receipt.inputHash && matchesLinks(batch.links, receipt.links),
      );
      if (matchingIndex === -1) {
        failure = unverifiableRestoredGateReason();
      } else {
        pending.splice(matchingIndex, 1);
      }
      continue;
    }
    if (entry.type === "custom" && entry.customType === PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE) {
      pending.length = 0;
      candidateLinks = [];
      const supersession = deserializeProjectRuleSupersession(entry.data);
      failure =
        supersession?.inputHash === currentInputHash
          ? undefined
          : "Project instruction supersession state cannot be verified. Restart in legacy mode before mutating work.";
      continue;
    }
    if (entry.type === "custom" && entry.customType === PROJECT_RULE_BATCH_CUSTOM_TYPE) {
      const batch = deserializeProjectRuleBatch(entry.data);
      if (!batch) {
        failure = unverifiableRestoredGateReason();
      } else {
        pending.push(batch);
        candidateLinks = [];
      }
      continue;
    }
    if (entry.type !== "custom_message" || entry.customType !== RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE) continue;
    const content = projectInstructionContentText(entry.content);
    if (!containsProjectRuleRoutes(content)) continue;
    const restored = deserializeProjectRuleGate(entry.details);
    if (!restored || !matchesPersistedRouteContent(content, restored)) {
      failure = unverifiableRestoredGateReason();
      continue;
    }
    if (restored.inputHash !== currentInputHash) {
      failure =
        "Project instructions changed since the persisted routed turn. Restart in legacy mode before mutating work.";
      continue;
    }
    if (restored.failure) failure = restored.failure;
    const coveredLinks = new Set(
      pending.filter((batch) => batch.inputHash === restored.inputHash).flatMap((batch) => batch.links),
    );
    const restoredCandidates = (restored.candidateLinks ?? []).filter((link) => !coveredLinks.has(link));
    candidateLinks =
      restored.candidateMerge === "union"
        ? [...new Set([...candidateLinks, ...restoredCandidates])].slice(0, MAX_PROJECT_RULE_LINKS_PER_TURN)
        : restoredCandidates;
  }
  const batches = pending
    .filter((batch) => batch.inputHash === currentInputHash)
    .map((batch) => ({ links: batch.links, satisfied: false, generation: nextGeneration() }));
  if (pending.some((batch) => batch.inputHash !== currentInputHash)) {
    failure =
      "Project instructions changed since the persisted routed turn. Restart in legacy mode before mutating work.";
  }
  return batches.length > 0 || candidateLinks.length > 0 || failure
    ? { inputHash: currentInputHash, batches, activeGeneration: 0, candidateLinks, failure }
    : undefined;
}

export function persistProjectRuleSupersession(
  sessionManager: SessionManager,
  inputHash: string,
  source: "reload" | "model-refresh",
): void {
  sessionManager.appendCustomEntry(PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE, {
    version: 1,
    inputHash,
    source,
  });
}

function matchesPersistedRouteContent(content: string, gate: ProjectRuleGate): boolean {
  const routes = [
    ...content.matchAll(/<project_rule_routes input_sha256="([a-f0-9]{64})">([\s\S]*?)<\/project_rule_routes>/gu),
  ];
  if (routes.length !== 1 || gate.failure || gate.batches.length !== 0 || routes[0]?.[1] !== gate.inputHash) {
    return false;
  }
  const links = [...(routes[0]?.[2]?.matchAll(/^- `(rules\/[a-z0-9./-]+)`:/gmu) ?? [])].map((match) => match[1]!);
  return matchesLinks(gate.candidateLinks ?? [], links);
}

function deserializeProjectRuleBatch(data: unknown): { inputHash: string; links: string[] } | undefined {
  if (!isRecord(data) || data.version !== 1 || data.source !== "action" || typeof data.inputHash !== "string") {
    return undefined;
  }
  const links = deserializeProjectRuleLinks(data.links);
  return links ? { inputHash: data.inputHash, links } : undefined;
}

function deserializeProjectRuleReceipt(data: unknown): { inputHash: string; links: string[] } | undefined {
  if (!isRecord(data) || data.version !== 1 || typeof data.inputHash !== "string") return undefined;
  const links = deserializeProjectRuleLinks(data.links);
  return links ? { inputHash: data.inputHash, links } : undefined;
}

function deserializeProjectRuleSupersession(
  data: unknown,
): { inputHash: string; source: "reload" | "model-refresh" } | undefined {
  if (
    !isRecord(data) ||
    data.version !== 1 ||
    typeof data.inputHash !== "string" ||
    (data.source !== "reload" && data.source !== "model-refresh")
  ) {
    return undefined;
  }
  return { inputHash: data.inputHash, source: data.source };
}

function deserializeProjectRuleLinks(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return undefined;
  const links = value.filter((link): link is string => typeof link === "string" && link.length > 0);
  return links.length === value.length && new Set(links).size === links.length ? links : undefined;
}

function matchesLinks(left: string[], right: string[]): boolean {
  if (left.length !== right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) {
    return false;
  }
  const expected = new Set(left);
  return right.every((link) => expected.has(link));
}

function stripProjectInstructionContent(
  content: string | (TextContent | ImageContent)[],
  allowedTags: ReadonlySet<string>,
): string | (TextContent | ImageContent)[] {
  if (typeof content === "string") return stripProjectInstructionBlocks(content, allowedTags);
  let changed = false;
  const sanitized = content.map((part) => {
    if (part.type !== "text") return part;
    const text = stripProjectInstructionBlocks(part.text, allowedTags);
    if (text === part.text) return part;
    changed = true;
    return { ...part, text };
  });
  return changed ? sanitized : content;
}

function stripProjectInstructionBlocks(content: string, allowedTags: ReadonlySet<string>): string {
  let sanitized = content;
  for (const tag of PROJECT_INSTRUCTION_BLOCK_TAGS) {
    if (allowedTags.has(tag)) continue;
    const block = new RegExp(`\\s*<${tag}\\b[^>]*>[\\s\\S]*?(?:<\\/${tag}>|$)\\s*`, "giu");
    sanitized = sanitized.replace(block, "\n");
  }
  return sanitized.replace(/\n{3,}/gu, "\n\n").trim();
}

function isEmptyProjectInstructionContent(content: string | (TextContent | ImageContent)[]): boolean {
  if (typeof content === "string") return content.length === 0;
  return content.every((part) => part.type === "text" && part.text.length === 0);
}

function deserializeProjectRuleGate(details: unknown): ProjectRuleGate | undefined {
  if (!isRecord(details) || details.projectInstructionMode !== "compiled" || !isRecord(details.projectRuleGate)) {
    return undefined;
  }
  const gate = details.projectRuleGate;
  if (typeof gate.inputHash !== "string" || !Array.isArray(gate.batches) || gate.batches.length > 64) {
    return undefined;
  }
  const batches: ProjectRuleGate["batches"] = [];
  for (const batch of gate.batches) {
    if (!isRecord(batch) || !Array.isArray(batch.links) || batch.links.length < 1 || batch.links.length > 3) {
      return undefined;
    }
    const links = batch.links.filter((link): link is string => typeof link === "string" && link.length > 0);
    if (links.length !== batch.links.length || new Set(links).size !== links.length) return undefined;
    batches.push({ links, satisfied: false, generation: 0 });
  }
  const candidateLinks = deserializeProjectRuleLinks(gate.candidateLinks);
  if (!candidateLinks) return undefined;
  if (gate.candidateMerge !== undefined && gate.candidateMerge !== "union") return undefined;
  return {
    inputHash: gate.inputHash,
    batches,
    activeGeneration: 0,
    candidateLinks,
    ...(gate.candidateMerge === "union" ? { candidateMerge: gate.candidateMerge } : {}),
    failure: typeof gate.failure === "string" ? gate.failure : undefined,
  };
}

function projectInstructionContentText(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

function containsProjectRuleRoutes(content: string): boolean {
  return /<project_rule_routes\b/iu.test(content);
}

function unverifiableRestoredGateReason(): string {
  return "Persisted compiled route state cannot be verified. Restart in legacy mode before mutating work.";
}
