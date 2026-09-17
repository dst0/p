import type { AgentMessage, ToolEffectDeclaration } from "@dst0/p-agent-core";
import type { AssistantMessage, TextContent } from "@dst0/p-ai";

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

export function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

interface PlanModeToolInfo {
  name: string;
  effect?: ToolEffectDeclaration;
}

export function getPlanModeTools(activeTools: readonly string[], allTools: readonly PlanModeToolInfo[]): string[] {
  const effects = new Map(allTools.map((tool) => [tool.name, tool.effect]));
  return activeTools.filter((tool) => {
    if (tool === "bash") return true;
    const effect = effects.get(tool);
    return effect?.kind === "read" && effect.risk === "normal";
  });
}

export function restorePlanModeTools(savedTools: readonly string[] | null, currentTools: readonly string[]): string[] {
  return Array.from(new Set([...(savedTools ?? []), ...currentTools]));
}

export const PLAN_MODE_SYSTEM_INSTRUCTION = `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use read-only tools (edit and write are disabled)
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`;

export function formatPlanExecutionContext(todoItems: readonly TodoItem[]): string {
  const remaining = todoItems.filter((item) => !item.completed);
  const todoList = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");
  return `[EXECUTING PLAN - Full tool access enabled]\n\nRemaining steps:\n${todoList}\n\nExecute each step in order.\nAfter completing a step, include a [DONE:n] tag in your response.`;
}

export function formatPlanExecutionRequest(todoItems: readonly TodoItem[]): string {
  if (todoItems.length === 0) return "Execute the plan you just created.";
  const todoList = todoItems.map((item) => `${item.step}. ${item.text}`).join("\n");
  return `Execute the following plan:\n\n${todoList}\n\nStart with step 1: ${todoItems[0].text}`;
}

export function rebuildResumeCompletionState(entries: readonly unknown[], todoItems: TodoItem[]): void {
  if (todoItems.length === 0) return;
  let executeIndex = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as { customType?: string };
    if (entry.customType === "plan-mode-execute") {
      executeIndex = index;
      break;
    }
  }

  const messages: AssistantMessage[] = [];
  for (let index = executeIndex + 1; index < entries.length; index++) {
    const entry = entries[index] as { type?: string; message?: unknown };
    if (entry.type === "message" && entry.message && isAssistantMessage(entry.message as AgentMessage)) {
      messages.push(entry.message as AssistantMessage);
    }
  }
  markCompletedSteps(messages.map(getTextContent).join("\n"), todoItems);
}

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\s*$/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+--version\s*$/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*jq\b/,
  /^\s*rg\b/,
  /^\s*eza\b/,
];

// Plan-mode shell commands use plain whitespace-delimited arguments only.
// Reject all quoting, escaping, expansion, globbing, composition, and redirection
// so the classified text is the exact argv shape seen by the executable.
const UNSAFE_SHELL_SYNTAX = /[;&|<>`\\$'"*?[\]{}\r\n]/;
const INTERPRETER_PATTERN = /(?:^|\s)(?:\S*\/)?(?:ba|z|fi)?sh\b|(?:^|\s)(?:\S*\/)?(?:perl|ruby|python\d*|node)\b/i;
const VERSION_ONLY_INTERPRETER = /^\s*(?:node|python\d*)\s+--version\s*$/i;
const MUTATING_READ_COMMAND_OPTIONS = [
  /^\s*find\b.*\s-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)\b/i,
  /^\s*git\s+branch\b\s+(?!--show-current\s*$|--list(?:\s|$)|--all\s*$|--remotes\s*$|-a\s*$|-r\s*$|-v{1,2}\s*$)/i,
  /^\s*git\s+remote\s+(?:add|remove|rename|set-head|set-branches|set-url|show|prune|update)\b/i,
  /^\s*git\s+(?:diff|show|log)\b.*\s--(?:output|ext-diff)(?:=|\s|$)/i,
  /^\s*file\b.*\s(?:-[A-Za-z]*C[A-Za-z]*|--compile)(?:\s|$)/i,
  /^\s*curl\b.*(?:\s-[oOT]\b|\s--(?:output|remote-name|upload-file|data|form|json|request)(?:=|\s|$))/i,
  /^\s*rg\b.*\s--(?:pre|hostname-bin)(?:=|\s|$)/i,
];

export function isSafeCommand(command: string): boolean {
  if (UNSAFE_SHELL_SYNTAX.test(command)) return false;
  if (INTERPRETER_PATTERN.test(command) && !VERSION_ONLY_INTERPRETER.test(command)) return false;
  if (MUTATING_READ_COMMAND_OPTIONS.some((pattern) => pattern.test(command))) return false;
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
  const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
  return !isDestructive && isSafe;
}

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
}

export function cleanStepText(text: string): string {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
    .replace(/`([^`]+)`/g, "$1") // Remove code
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  if (cleaned.length > 50) {
    cleaned = `${cleaned.slice(0, 47)}...`;
  }
  return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
  const items: TodoItem[] = [];
  const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
  if (!headerMatch) return items;

  const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
  const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

  for (const match of planSection.matchAll(numberedPattern)) {
    const text = match[2]
      .trim()
      .replace(/\*{1,2}$/, "")
      .trim();
    if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
      const cleaned = cleanStepText(text);
      if (cleaned.length > 3) {
        items.push({ step: items.length + 1, text: cleaned, completed: false });
      }
    }
  }
  return items;
}

export function extractDoneSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) steps.push(step);
  }
  return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
  const doneSteps = extractDoneSteps(text);
  for (const step of doneSteps) {
    const item = items.find((t) => t.step === step);
    if (item) item.completed = true;
  }
  return doneSteps.length;
}
