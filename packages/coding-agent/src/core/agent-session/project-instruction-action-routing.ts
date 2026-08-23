import { type PreparedProjectInstructions, selectProjectInstructionRuleLinks } from "../project-instructions/index.ts";
import { tokenizeShellCommands } from "../task-verification/git-command-classification.ts";
import {
  isDirectMutationTool,
  isRecognizedBashMutation,
  isShellTool,
  shellCommand,
} from "../task-verification/tool-classification.ts";
import type { AgentSession } from "./agentsession.ts";
import { inferProjectInstructionActionPhases } from "./project-instruction-action-phases.ts";
import { PROJECT_RULE_BATCH_CUSTOM_TYPE } from "./project-instruction-integrity.ts";
import { MAX_PROJECT_RULE_LINKS_PER_TURN } from "./state-types.ts";

const ACTION_ROUTING_CHUNK_LENGTH = 16_384;
const ACTION_ROUTING_CHUNK_OVERLAP = 500;

export function stageProjectInstructionActionBatch(
  self: AgentSession,
  prepared: PreparedProjectInstructions,
  toolName: string,
  args: unknown,
): string | undefined {
  const gate = self._projectRuleGate;
  if (!gate || gate.failure || gate.inputHash !== prepared.manifest.inputHash) return;
  if (gate.batches.some((batch) => !batch.satisfied)) return;
  if (gate.batches.length > 0) {
    if ((gate.candidateLinks?.length ?? 0) === 0) return;
    gate.batches = [];
  }
  const toolEntry = self._toolDefinitions.get(toolName);
  const customDescription = toolEntry?.sourceInfo.source === "builtin" ? undefined : toolEntry?.definition.description;
  const actionQuery = describeAction(toolName, args, customDescription).join("\n");
  const actionLinks = selectProjectInstructionRuleLinks(prepared.manifest.rules, actionQuery);
  const primaryActionLink = actionLinks[0];
  const links = [
    ...new Set([
      ...(primaryActionLink ? [primaryActionLink] : []),
      ...(gate.candidateLinks ?? []),
      ...actionLinks.slice(1),
    ]),
  ].slice(0, MAX_PROJECT_RULE_LINKS_PER_TURN);
  if (links.length === 0) return;
  const batch = { links, satisfied: false, generation: gate.activeGeneration };
  self.sessionManager.appendCustomEntry(PROJECT_RULE_BATCH_CUSTOM_TYPE, {
    version: 1,
    inputHash: gate.inputHash,
    links: [...batch.links],
    source: "action",
  });
  gate.batches.push(batch);
  gate.candidateLinks = [];
  return undefined;
}

function describeAction(toolName: string, args: unknown, toolDescription: string | undefined): string[] {
  let serialized: string;
  try {
    serialized = JSON.stringify(args) ?? "";
  } catch {
    serialized = String(args);
  }
  const prefix = `${toolName}\n`;
  const chunks: string[] = [];
  const semanticQuery = describeActionSemantics(toolName, args, toolDescription);
  if (prefix.length + serialized.length <= ACTION_ROUTING_CHUNK_LENGTH) {
    return semanticQuery ? [`${prefix}${serialized}`, semanticQuery] : [`${prefix}${serialized}`];
  }
  const payloadLength = ACTION_ROUTING_CHUNK_LENGTH - prefix.length;
  const step = payloadLength - ACTION_ROUTING_CHUNK_OVERLAP;
  for (let offset = 0; offset < serialized.length; offset += step) {
    chunks.push(`${prefix}${serialized.slice(offset, offset + payloadLength)}`);
  }
  return semanticQuery ? [...chunks, semanticQuery] : chunks;
}

function describeActionSemantics(toolName: string, args: unknown, toolDescription: string | undefined): string {
  const labels = new Set<string>();
  const phases = inferProjectInstructionActionPhases(toolName, args, toolDescription);
  if (phases.length > 0) labels.add(`work phases ${phases.join(" ")}`);
  if (isDirectMutationTool(toolName)) labels.add("file modification code changes edit write patch replace");
  if (toolName === "process") labels.add("process execution command lifecycle");
  if (isShellTool(toolName)) addShellSemantics(labels, shellCommand(args), isRecognizedBashMutation(args));
  if (!isShellTool(toolName) && !isDirectMutationTool(toolName) && toolName !== "process") {
    labels.add("custom tool action");
  }
  if (toolDescription?.trim()) labels.add(toolDescription.trim());
  return labels.size > 0 ? `${toolName}\n${[...labels].join("\n")}` : "";
}

function addShellSemantics(labels: Set<string>, command: string, mutates: boolean): void {
  const invocations = tokenizeShellCommands(command);
  const words = invocations.flat().map((word) => word.toLocaleLowerCase("en-US"));
  const names = new Set(words.map((word) => word.split("/").at(-1) ?? word));
  if (mutates) labels.add("file modification code changes");
  if (invocations.some(isTestInvocation)) {
    labels.add("test testing verification");
  }
  if (names.has("git")) labels.add("git version control repository branch commit push merge rebase");
  if (
    names.has("install") ||
    (["npm", "pnpm", "yarn", "bun", "cargo", "pip"].some((name) => names.has(name)) &&
      words.some((word) => /^(?:add|install|update)$/u.test(word)))
  ) {
    labels.add("dependency package install installation update");
  }
  if (names.has("deploy")) labels.add("deploy production delivery baseline");
  if (names.has("publish")) labels.add("publish release changelog");
  if (names.has("release")) labels.add("release version changelog");
  if (names.has("reinstall")) labels.add("reinstall build installation");
  if (names.has("version-bump")) labels.add("version bump release changelog");
  if ([...names].some((name) => /^(?:rm|rmdir|unlink|trash)$/u.test(name))) {
    labels.add("file delete deletion remove removal");
  }
  if ([...names].some((name) => /^(?:biome|prettier)$/u.test(name))) labels.add("format formatting");
  if ([...names].some((name) => /^(?:migrate|migration)$/u.test(name))) labels.add("database migration");
}

function isTestInvocation(words: readonly string[]): boolean {
  const normalized = words.map((word) => word.toLocaleLowerCase("en-US"));
  const executable = normalized[0]?.split("/").at(-1);
  if (!executable) return false;
  if (/^(?:vitest|jest|pytest|rspec|test)$/u.test(executable)) return true;
  if (executable === "node") return normalized.includes("--test");
  if (["cargo", "go"].includes(executable)) return normalized[1] === "test";
  if (!["npm", "pnpm", "yarn", "bun"].includes(executable)) return false;
  return normalized[1] === "test" || (normalized[1] === "run" && normalized[2]?.startsWith("test") === true);
}
