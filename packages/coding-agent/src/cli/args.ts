/** CLI argument parsing and help display. */
import type { CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import { parseRunBudgetArgument, type RunBudgetPolicy } from "../core/run-budget-policy.ts";
import {
  COMPLETION_MODE_LABELS,
  isProjectInstructionMode,
  isTaskVerificationMode,
  isValidThinkingLevel,
  PROJECT_INSTRUCTION_MODES,
  type ProjectInstructionDeliveryMode,
  parseCompletionMode,
  parsePositiveIntegerFlag,
  TASK_VERIFICATION_MODES,
  type TaskVerificationMode,
} from "./argument-values.ts";

export { printHelp } from "./args-help.ts";

export { isValidThinkingLevel } from "./argument-values.ts";
export type Mode = "text" | "json" | "rpc";
export interface Args {
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  thinking?: ThinkingLevel;
  maxTokens?: number;
  runBudget?: RunBudgetPolicy;
  completionMode?: CompletionMode;
  projectInstructionMode?: ProjectInstructionDeliveryMode;
  taskVerificationMode?: TaskVerificationMode;
  projectInstructionCompilerModel?: string;
  continue?: boolean;
  resume?: boolean;
  help?: boolean;
  version?: boolean;
  mode?: Mode;
  name?: string;
  noSession?: boolean;
  session?: string;
  sessionId?: string;
  fork?: string;
  sessionDir?: string;
  models?: string[];
  tools?: string[];
  excludeTools?: string[];
  noTools?: boolean;
  noBuiltinTools?: boolean;
  extensions?: string[];
  noExtensions?: boolean;
  print?: boolean;
  export?: string;
  noSkills?: boolean;
  skills?: string[];
  promptTemplates?: string[];
  noPromptTemplates?: boolean;
  themes?: string[];
  noThemes?: boolean;
  noContextFiles?: boolean;
  listModels?: string | true;
  offline?: boolean;
  verbose?: boolean;
  projectTrustOverride?: boolean;
  messages: string[];
  fileArgs: string[];
  /** Unknown flags (potentially extension flags) - map of flag name to value */
  unknownFlags: Map<string, boolean | string>;
  diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}
export function parseArgs(args: string[]): Args {
  const result: Args = {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--mode" && i + 1 < args.length) {
      const mode = args[++i];
      if (mode === "text" || mode === "json" || mode === "rpc") {
        result.mode = mode;
      }
    } else if (arg === "--continue" || arg === "-c") {
      result.continue = true;
    } else if (arg === "--resume" || arg === "-r") {
      result.resume = true;
    } else if (arg === "--provider" && i + 1 < args.length) {
      result.provider = args[++i];
    } else if (arg === "--model" && i + 1 < args.length) {
      result.model = args[++i];
    } else if (arg === "--api-key" && i + 1 < args.length) {
      result.apiKey = args[++i];
    } else if (arg === "--system-prompt" && i + 1 < args.length) {
      result.systemPrompt = args[++i];
    } else if (arg === "--append-system-prompt" && i + 1 < args.length) {
      result.appendSystemPrompt = result.appendSystemPrompt ?? [];
      result.appendSystemPrompt.push(args[++i]);
    } else if (arg === "--name" || arg === "-n") {
      if (i + 1 < args.length) {
        result.name = args[++i];
        if (!result.name.trim())
          result.diagnostics.push({ type: "error", message: "--name requires a non-empty value" });
      } else {
        result.diagnostics.push({ type: "error", message: "--name requires a value" });
      }
    } else if (arg === "--no-session") {
      result.noSession = true;
    } else if (arg === "--session" && i + 1 < args.length) {
      result.session = args[++i];
    } else if (arg === "--session-id" && i + 1 < args.length) {
      result.sessionId = args[++i];
    } else if (arg === "--fork" && i + 1 < args.length) {
      result.fork = args[++i];
    } else if (arg === "--session-dir" && i + 1 < args.length) {
      result.sessionDir = args[++i];
    } else if (arg === "--models" && i + 1 < args.length) {
      result.models = args[++i].split(",").map((s) => s.trim());
    } else if (arg === "--no-tools" || arg === "-nt") {
      result.noTools = true;
    } else if (arg === "--no-builtin-tools" || arg === "-nbt") {
      result.noBuiltinTools = true;
    } else if ((arg === "--tools" || arg === "-t") && i + 1 < args.length) {
      result.tools = args[++i]
        .split(",")
        .map((s) => s.trim())
        .filter((name) => name.length > 0);
    } else if ((arg === "--exclude-tools" || arg === "-xt") && i + 1 < args.length) {
      result.excludeTools = args[++i]
        .split(",")
        .map((s) => s.trim())
        .filter((name) => name.length > 0);
    } else if (arg === "--thinking" && i + 1 < args.length) {
      const level = args[++i];
      if (isValidThinkingLevel(level)) {
        result.thinking = level;
      } else {
        result.diagnostics.push({
          type: "warning",
          message: `Invalid thinking level "${level}". Valid values: off, minimal, low, medium, high, xhigh`,
        });
      }
    } else if (arg === "--budget" || arg.startsWith("--budget=")) {
      const value = arg.startsWith("--budget=") ? arg.slice(9) : args[i + 1];
      if (arg === "--budget" && value !== undefined && !value.startsWith("--")) i++;
      try {
        result.runBudget = parseRunBudgetArgument(value ?? "");
      } catch (error) {
        result.diagnostics.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } else if (arg === "--max-tokens") {
      if (i + 1 >= args.length) {
        result.diagnostics.push({ type: "error", message: "--max-tokens requires a value" });
      } else {
        const value = args[++i];
        const maxTokens = parsePositiveIntegerFlag(value);
        if (maxTokens === undefined) {
          result.diagnostics.push({
            type: "error",
            message: `--max-tokens requires a positive integer, got "${value}"`,
          });
        } else {
          result.maxTokens = maxTokens;
        }
      }
    } else if (arg === "--project-instructions") {
      const mode = args[i + 1];
      if (mode && !mode.startsWith("-") && isProjectInstructionMode(mode)) {
        result.projectInstructionMode = mode;
        i++;
      } else {
        if (mode && !mode.startsWith("-")) i++;
        result.diagnostics.push({
          type: "error",
          message: `--project-instructions requires one of: ${PROJECT_INSTRUCTION_MODES.join(", ")}`,
        });
      }
    } else if (arg === "--project-instruction-compiler-model") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        result.diagnostics.push({
          type: "error",
          message: "--project-instruction-compiler-model requires a provider/id value",
        });
      } else result.projectInstructionCompilerModel = args[++i];
    } else if (arg === "--task-verification") {
      const mode = args[i + 1];
      if (mode && !mode.startsWith("-") && isTaskVerificationMode(mode)) {
        result.taskVerificationMode = mode;
        i++;
      } else {
        if (mode && !mode.startsWith("-")) i++;
        result.diagnostics.push({
          type: "error",
          message: `--task-verification requires one of: ${TASK_VERIFICATION_MODES.join(", ")}`,
        });
      }
    } else if (arg === "--completion-mode" && i + 1 < args.length) {
      const mode = args[++i];
      const completionMode = parseCompletionMode(mode);
      if (completionMode) {
        result.completionMode = completionMode;
      } else {
        result.diagnostics.push({
          type: "warning",
          message: `Invalid completion mode "${mode}". Valid values: ${COMPLETION_MODE_LABELS.join(", ")}`,
        });
      }
    } else if (arg === "--print" || arg === "-p") {
      result.print = true;
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("@") && (!next.startsWith("-") || next.startsWith("---"))) {
        result.messages.push(next);
        i++;
      }
    } else if (arg === "--export" && i + 1 < args.length) {
      result.export = args[++i];
    } else if ((arg === "--extension" || arg === "-e") && i + 1 < args.length) {
      result.extensions = result.extensions ?? [];
      result.extensions.push(args[++i]);
    } else if (arg === "--no-extensions" || arg === "-ne") {
      result.noExtensions = true;
    } else if (arg === "--skill" && i + 1 < args.length) {
      result.skills = result.skills ?? [];
      result.skills.push(args[++i]);
    } else if (arg === "--prompt-template" && i + 1 < args.length) {
      result.promptTemplates = result.promptTemplates ?? [];
      result.promptTemplates.push(args[++i]);
    } else if (arg === "--theme" && i + 1 < args.length) {
      result.themes = result.themes ?? [];
      result.themes.push(args[++i]);
    } else if (arg === "--no-skills" || arg === "-ns") {
      result.noSkills = true;
    } else if (arg === "--no-prompt-templates" || arg === "-np") {
      result.noPromptTemplates = true;
    } else if (arg === "--no-themes") {
      result.noThemes = true;
    } else if (arg === "--no-context-files" || arg === "-nc") {
      result.noContextFiles = true;
    } else if (arg === "--list-models") {
      // Check if next arg is a search pattern (not a flag or file arg)
      if (i + 1 < args.length && !args[i + 1].startsWith("-") && !args[i + 1].startsWith("@")) {
        result.listModels = args[++i];
      } else {
        result.listModels = true;
      }
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "--approve" || arg === "-a") {
      result.projectTrustOverride = true;
    } else if (arg === "--no-approve" || arg === "-na") {
      result.projectTrustOverride = false;
    } else if (arg === "--offline") {
      result.offline = true;
    } else if (arg.startsWith("@")) {
      result.fileArgs.push(arg.slice(1)); // Remove @ prefix
    } else if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
      } else {
        const flagName = arg.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
          result.unknownFlags.set(flagName, next);
          i++;
        } else {
          result.unknownFlags.set(flagName, true);
        }
      }
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
    } else if (!arg.startsWith("-")) {
      result.messages.push(arg);
    }
  }
  return result;
}
