import { inferBenchmarkProjectInstructionPhases } from "./phases.ts";

export { inferBenchmarkProjectInstructionPhases } from "./phases.ts";
export { selectBenchmarkProjectInstructionRuleLinks } from "./selector.ts";

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
const TRUSTED_SAFE_TOOLS = new Set([
  ...PHASE_NEUTRAL_TOOLS,
  "find",
  "finish_work",
  "grep",
  "list",
  "ls",
  "read",
  "semantic_search",
]);
const KNOWN_BUILTIN_TOOLS = new Set([...TRUSTED_SAFE_TOOLS, "bash", "edit", "process", "write"]);
const KNOWN_STATIC_TOOLS = new Set(["read", "rg", "grep", "find", "ls", "semantic_search"]);
const KNOWN_DIRECT_MUTATION_TOOLS = new Set(["edit", "write"]);
const DISCOVERY_COMMANDS = new Set(["cat", "find", "grep", "head", "ls", "rg", "sed", "tail", "wc"]);
const TEST_COMMAND_PATTERN = /^(?:jest|pytest|rspec|test(?::[^\s]+)?|vitest)$/u;
const VERIFICATION_COMMAND_PATTERN = /^(?:benchmark|build|check(?::[^\s]+)?|lint|smoke|tsc|typecheck)$/u;
const DELIVERY_COMMAND_PATTERN = /^(?:deploy|publish|release|version-bump)$/u;
const DELIVERY_GIT_SUBCOMMANDS = new Set(["commit", "merge", "push", "rebase", "tag"]);
const DISCOVERY_GIT_SUBCOMMANDS = new Set(["diff", "log", "show", "status"]);
const BASH_MUTATION_PATTERN =
  /(?:^|[;&|]\s*)(?:sed\s+-i|perl\s+-[a-z]*i|patch\b|git\s+(?:apply|am|cherry-pick|merge|rebase|checkout|switch|reset|restore)\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|truncate\b|tee\b|npm\s+(?:install|uninstall|update)\b|pnpm\s+(?:add|remove|install|update)\b|yarn\s+(?:add|remove|install|upgrade)\b|bun\s+(?:add|remove|install|update)\b|cargo\s+(?:add|remove|update)\b|node\s+scripts\/version-bump\.js\b|\.\/reinstall\.sh\b)/iu;
const WRITE_REDIRECT_PATTERN = /(?:^|[;&|]\s*)(?:echo|printf|cat)\b[^\n;]*(?:>|>>)\s*(?!\/dev\/null\b)/iu;
const CONFIDENTLY_READ_ONLY_SHELL_COMMANDS = new Set([
  "cat",
  "cmp",
  "diff",
  "file",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "shasum",
  "stat",
  "tail",
  "test",
  "wc",
  "which",
]);
const CONFIDENTLY_READ_ONLY_GIT_SUBCOMMANDS = new Set(["diff", "log", "show", "status"]);

export function inferBenchmarkProjectInstructionActionPhases(
  toolName: string,
  args: unknown,
  toolDescription?: string,
): string[] {
  if (PHASE_NEUTRAL_TOOLS.has(toolName)) return [];
  const phases = new Set<string>();
  if (toolName === "finish_work") phases.add("closure");
  if (isDirectMutationTool(toolName)) phases.add("implementation");
  if (isStaticTool(toolName)) phases.add("discovery");
  if (toolName === "process") phases.add("verification");
  if (isShellTool(toolName)) addShellPhases(phases, args);
  for (const phase of inferBenchmarkProjectInstructionPhases(toolDescription ?? "")) phases.add(phase);
  return [...phases];
}

export function describeBenchmarkProjectInstructionAction(
  toolName: string,
  args: unknown,
  toolDescription?: string,
): { phases: string[]; queries: string[] } | undefined {
  const routedDescription = KNOWN_BUILTIN_TOOLS.has(toolName) ? undefined : toolDescription;
  const phases = inferBenchmarkProjectInstructionActionPhases(toolName, args, routedDescription);
  const mayMutate = isShellTool(toolName)
    ? !isBenchmarkProjectInstructionReadOnlyShellTool(toolName, args)
    : isDirectMutationTool(toolName) || !TRUSTED_SAFE_TOOLS.has(toolName);
  if (!mayMutate) return undefined;
  const prefix = `${toolName}\n`;
  const serialized = safeJson(args);
  const semanticQuery = actionSemanticQuery(toolName, args, routedDescription, phases);
  const chunkLength = 16_384;
  if (prefix.length + serialized.length <= chunkLength) {
    return { phases, queries: semanticQuery ? [`${prefix}${serialized}`, semanticQuery] : [`${prefix}${serialized}`] };
  }
  const queries: string[] = [];
  const payloadLength = chunkLength - prefix.length;
  const step = payloadLength - 500;
  for (let offset = 0; offset < serialized.length; offset += step) {
    queries.push(`${prefix}${serialized.slice(offset, offset + payloadLength)}`);
  }
  if (semanticQuery) queries.push(semanticQuery);
  return { phases, queries };
}

export function isBenchmarkProjectInstructionReadOnlyShellTool(toolName: string, args: unknown): boolean {
  if (!isShellTool(toolName)) return false;
  const command = shellCommand(args);
  if (!command || /[\n\r`$()<>]/u.test(command)) return false;
  const commands = tokenizeShellCommands(command);
  if (commands.length === 0) return false;
  return commands.every((words) => {
    const executable = words[0];
    if (!executable || executable.includes("/") || executable.includes("\\")) return false;
    const name = executable.toLocaleLowerCase("en-US");
    if (name === "find" && words.some((word) => /^-(?:delete|exec|execdir|ok|okdir)$/u.test(word))) return false;
    if (name === "rg" && words.some((word) => word === "--pre" || word.startsWith("--pre="))) return false;
    if (
      name === "file" &&
      words.slice(1).some((word) => word === "--compile" || (/^-[^-]*C/u.test(word) && word !== "-"))
    ) {
      return false;
    }
    if (name === "diff" && words.slice(1).some((word) => word === "--output" || word.startsWith("--output="))) {
      return false;
    }
    if (name === "git") {
      const subcommand = words[1]?.toLocaleLowerCase("en-US");
      const unsafeOption = words
        .slice(2)
        .some(
          (word) =>
            word === "--output" || word.startsWith("--output=") || word === "--ext-diff" || word === "--textconv",
        );
      return subcommand !== undefined && CONFIDENTLY_READ_ONLY_GIT_SUBCOMMANDS.has(subcommand) && !unsafeOption;
    }
    return CONFIDENTLY_READ_ONLY_SHELL_COMMANDS.has(name);
  });
}

function addShellPhases(phases: Set<string>, args: unknown): void {
  for (const words of tokenizeShellCommands(shellCommand(args))) {
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

function actionSemanticQuery(
  toolName: string,
  args: unknown,
  toolDescription: string | undefined,
  phases: string[],
): string {
  const labels = new Set<string>();
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
  const words = tokenizeShellCommands(command)
    .flat()
    .map((word) => word.toLocaleLowerCase("en-US"));
  const names = new Set(words.map((word) => word.split("/").at(-1) ?? word));
  if (mutates) labels.add("file modification code changes");
  if (names.has("test") || [...names].some((name) => /^(?:vitest|jest|pytest|rspec)$/u.test(name))) {
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

function tokenizeShellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: string | undefined;
  let escaped = false;
  const finishWord = () => {
    if (!wordStarted) return;
    words.push(word);
    word = "";
    wordStarted = false;
  };
  const finishCommand = () => {
    finishWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (const character of command) {
    if (escaped) {
      word += character;
      wordStarted = true;
      escaped = false;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"') escaped = true;
      else word += character;
      wordStarted = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      wordStarted = true;
    } else if (character === "\\") {
      escaped = true;
      wordStarted = true;
    } else if (/\s/u.test(character)) {
      finishWord();
      if (character === "\n") finishCommand();
    } else if (character === ";" || character === "&" || character === "|") {
      finishCommand();
    } else {
      word += character;
      wordStarted = true;
    }
  }
  if (escaped) word += "\\";
  finishCommand();
  return commands;
}

function isShellTool(toolName: string): boolean {
  return (
    ["bash", "ctx_shell", "run_command", "exec", "shell", "terminal"].includes(toolName) || toolName.endsWith("_shell")
  );
}

function isStaticTool(toolName: string): boolean {
  if (KNOWN_STATIC_TOOLS.has(toolName)) return true;
  if (isShellTool(toolName)) return false;
  return /read|grep|search|view|list|glob/u.test(toolName.toLowerCase());
}

function isDirectMutationTool(toolName: string): boolean {
  if (KNOWN_DIRECT_MUTATION_TOOLS.has(toolName)) return true;
  return /edit|write|patch|replace/u.test(toolName.toLowerCase());
}

function shellCommand(args: unknown): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const value = record.command ?? record.cmd ?? record.script ?? record.code ?? record.CommandLine;
  return typeof value === "string" ? value.trim() : "";
}

function isRecognizedBashMutation(args: unknown): boolean {
  const command = shellCommand(args);
  return BASH_MUTATION_PATTERN.test(command) || WRITE_REDIRECT_PATTERN.test(command);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
