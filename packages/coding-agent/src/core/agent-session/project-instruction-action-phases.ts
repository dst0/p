import type { ProjectInstructionWorkPhase } from "../project-instructions/work-phases.ts";
import { inferProjectInstructionPhases } from "../project-instructions/work-phases.ts";
import { tokenizeShellCommands } from "../task-verification/git-command-classification.ts";
import {
  isDirectMutationTool,
  isRecognizedBashMutation,
  isShellTool,
  isStaticTool,
  shellCommand,
} from "../task-verification/tool-classification.ts";

const PHASE_NEUTRAL_TOOLS = new Set([
  "ask_user",
  "confirm_user",
  "keep_context",
  "list_skills",
  "mark_session_progress",
  "read_rules",
  "read_skills",
  "session_recall",
  "sleep",
  "tool_search",
  "update_session_state",
]);
const DISCOVERY_COMMANDS = new Set(["cat", "find", "grep", "head", "ls", "rg", "sed", "tail", "wc"]);
const TEST_COMMAND_PATTERN = /^(?:jest|pytest|rspec|test(?::[^\s]+)?|vitest)$/u;
const VERIFICATION_COMMAND_PATTERN = /^(?:benchmark|build|check(?::[^\s]+)?|lint|smoke|tsc|typecheck)$/u;
const DELIVERY_COMMAND_PATTERN = /^(?:deploy|publish|release|version-bump)$/u;
const DELIVERY_GIT_SUBCOMMANDS = new Set(["commit", "merge", "push", "rebase", "tag"]);
const DISCOVERY_GIT_SUBCOMMANDS = new Set(["diff", "log", "show", "status"]);

export function inferProjectInstructionActionPhases(
  toolName: string,
  args: unknown,
  toolDescription?: string,
): ProjectInstructionWorkPhase[] {
  if (PHASE_NEUTRAL_TOOLS.has(toolName)) return [];
  const phases = new Set<ProjectInstructionWorkPhase>();
  if (toolName === "finish_work") phases.add("closure");
  if (isDirectMutationTool(toolName)) phases.add("implementation");
  if (isStaticTool(toolName)) phases.add("discovery");
  if (toolName === "process") phases.add("verification");
  if (isShellTool(toolName)) addShellPhases(phases, args);
  for (const phase of inferProjectInstructionPhases(toolDescription ?? "")) phases.add(phase);
  return [...phases];
}

function addShellPhases(phases: Set<ProjectInstructionWorkPhase>, args: unknown): void {
  const commands = tokenizeShellCommands(shellCommand(args));
  for (const words of commands) {
    const names = words.map((word) => word.toLocaleLowerCase("en-US").split("/").at(-1) ?? word);
    if (names.some((name) => DISCOVERY_COMMANDS.has(name))) phases.add("discovery");
    if (names.some((name) => TEST_COMMAND_PATTERN.test(name))) phases.add("testing");
    if (names.some((name) => VERIFICATION_COMMAND_PATTERN.test(name))) phases.add("verification");
    if (names.some((name) => DELIVERY_COMMAND_PATTERN.test(name))) phases.add("delivery");
    const gitIndex = names.indexOf("git");
    const gitSubcommand = gitIndex >= 0 ? names.slice(gitIndex + 1).find((name) => !name.startsWith("-")) : undefined;
    if (gitSubcommand && DELIVERY_GIT_SUBCOMMANDS.has(gitSubcommand)) phases.add("delivery");
    if (gitSubcommand && DISCOVERY_GIT_SUBCOMMANDS.has(gitSubcommand)) phases.add("discovery");
  }
  if (isRecognizedBashMutation(args)) phases.add("implementation");
}
