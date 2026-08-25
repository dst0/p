import { tokenizeShellCommands } from "../git-command-classification.ts";
import { focusedShellInvocation } from "./focused-shell-command.ts";

export type TestEcosystem = "go" | "javascript" | "project" | "python" | "rust";

export interface TestCommandInvocation {
  args: string[];
  allowsBareName: boolean;
  ecosystem: TestEcosystem;
  scopeNarrowed?: boolean;
  workingDirectories: string[];
}

const SHELL_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const ENV_OPTIONS_WITH_VALUE = new Set(["-a", "--argv0", "-C", "--chdir", "-u", "--unset"]);
const PACKAGE_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-F",
  "-w",
  "--config",
  "--cwd",
  "--dir",
  "--filter",
  "--prefix",
  "--registry",
  "--userconfig",
  "--workspace",
]);
const NPX_OPTIONS_WITH_VALUE = new Set(["-c", "--call", "-p", "--package"]);
const PACKAGE_SCOPE_OPTIONS = new Set(["-C", "-F", "-w", "--cwd", "--dir", "--filter", "--prefix", "--workspace"]);
const TIME_OPTIONS_WITH_VALUE = new Set(["-f", "-o", "--format", "--output"]);
const TIMEOUT_OPTIONS_WITH_VALUE = new Set(["-k", "-s", "--kill-after", "--signal"]);
const MAX_WRAPPER_DEPTH = 4;

export function focusedTestInvocation(command: string, depth = 0): TestCommandInvocation | undefined {
  const shellInvocation = focusedShellInvocation(command);
  if (shellInvocation === undefined) return undefined;
  const invocation = invocationFromWords(shellInvocation.words, depth);
  if (invocation === undefined || shellInvocation.workingDirectory === undefined) return invocation;
  return {
    ...invocation,
    workingDirectories: [shellInvocation.workingDirectory, ...invocation.workingDirectories],
  };
}

export function commandContainsTestInvocation(command: string, depth = 0): boolean {
  if (depth > MAX_WRAPPER_DEPTH) return false;
  return tokenizeShellCommands(command).some((words) => {
    const unwrapped = unwrapCommandAndEnv(words);
    const nested = wrappedShellCommand(unwrapped);
    return nested !== undefined
      ? commandContainsTestInvocation(nested, depth + 1)
      : invocationFromWords(unwrapped, depth) !== undefined;
  });
}

function invocationFromWords(words: readonly string[], depth: number): TestCommandInvocation | undefined {
  if (depth > MAX_WRAPPER_DEPTH) return undefined;
  const unwrapped = unwrapCommandAndEnv(words);
  const executable = unwrapped[0]?.split("/").pop();
  if (executable === "lean-ctx") return nestedCommandInvocation(unwrapped, ["-c", "--command"], depth);
  if (executable === "bash" || executable === "sh" || executable === "zsh") {
    const command = shellCommandPayload(unwrapped);
    return command === undefined ? undefined : focusedTestInvocation(command, depth + 1);
  }
  if (executable === "timeout") {
    const nested = commandAfterTimeout(unwrapped);
    return nested === undefined ? undefined : invocationFromWords(nested, depth + 1);
  }
  if (executable === "time") {
    const nested = commandAfterOptions(unwrapped, TIME_OPTIONS_WITH_VALUE);
    return nested.length === 0 ? undefined : invocationFromWords(nested, depth + 1);
  }
  return directTestInvocation(unwrapped);
}

function nestedCommandInvocation(
  words: readonly string[],
  options: readonly string[],
  depth: number,
): TestCommandInvocation | undefined {
  const command = optionPayload(words, options);
  return command === undefined ? undefined : focusedTestInvocation(command, depth + 1);
}

function wrappedShellCommand(words: readonly string[]): string | undefined {
  const executable = words[0]?.split("/").pop();
  if (executable === "lean-ctx") return optionPayload(words, ["-c", "--command"]);
  return executable === "bash" || executable === "sh" || executable === "zsh" ? shellCommandPayload(words) : undefined;
}

function shellCommandPayload(words: readonly string[]): string | undefined {
  const commandIndex = words.findIndex(
    (word, index) => index > 0 && (word === "-c" || (/^-[^-]*c[^-]*$/u.test(word) && !word.includes("="))),
  );
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined;
}

function optionPayload(words: readonly string[], options: readonly string[]): string | undefined {
  const commandIndex = words.findIndex((word) => options.includes(word));
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined;
}

function unwrapCommandAndEnv(words: readonly string[]): string[] {
  let index = 0;
  while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
  while (index < words.length) {
    const executable = words[index]?.split("/").pop();
    if (executable === "command") {
      index += 1;
      while (words[index]?.startsWith("-") && words[index] !== "--") index += 1;
      if (words[index] === "--") index += 1;
    } else if (executable === "env") {
      index += 1;
      while (index < words.length) {
        const word = words[index]!;
        if (word === "--") {
          index += 1;
          break;
        }
        if (ENV_OPTIONS_WITH_VALUE.has(word)) index += 2;
        else if (word.startsWith("-") || SHELL_ASSIGNMENT_PATTERN.test(word)) index += 1;
        else break;
      }
    } else {
      break;
    }
    while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
  }
  return words.slice(index);
}

function commandAfterTimeout(words: readonly string[]): string[] | undefined {
  let index = 1;
  while (words[index]?.startsWith("-")) {
    const option = words[index]!;
    index += TIMEOUT_OPTIONS_WITH_VALUE.has(option) && !option.includes("=") ? 2 : 1;
  }
  if (words[index] === undefined) return undefined;
  return words.slice(index + 1);
}

function commandAfterOptions(words: readonly string[], optionsWithValue: ReadonlySet<string>): string[] {
  let index = 1;
  while (words[index]?.startsWith("-")) {
    const option = words[index]!;
    index += optionsWithValue.has(option) && !option.includes("=") ? 2 : 1;
  }
  return words.slice(index);
}

function directTestInvocation(words: readonly string[]): TestCommandInvocation | undefined {
  const executable = words[0]?.split("/").pop();
  if (executable === "vitest" || executable === "jest" || executable === "pytest" || executable === "test.sh") {
    const ecosystem = executable === "pytest" ? "python" : executable === "test.sh" ? "project" : "javascript";
    return { args: testRunnerArgs(words.slice(1)), allowsBareName: false, ecosystem, workingDirectories: [] };
  }
  if (executable === "cargo" || executable === "go") {
    return words[1] === "test"
      ? {
          args: words.slice(2),
          allowsBareName: executable === "cargo",
          ecosystem: executable === "cargo" ? "rust" : "go",
          workingDirectories: [],
        }
      : undefined;
  }
  if (executable === "bun" || executable === "yarn" || executable === "pnpm" || executable === "npm") {
    return packageManagerTestInvocation(executable, words);
  }
  if (executable === "npx") {
    const index = packageSubcommandIndex(words, NPX_OPTIONS_WITH_VALUE);
    return ["vitest", "jest"].includes(words[index] ?? "")
      ? {
          args: testRunnerArgs(words.slice(index + 1)),
          allowsBareName: false,
          ecosystem: "javascript",
          workingDirectories: [],
        }
      : undefined;
  }
  if (executable === "python" || executable === "python3") {
    const moduleIndex = words.findIndex((word, index) => index > 0 && word === "-m" && words[index + 1] === "pytest");
    return moduleIndex >= 0
      ? { args: words.slice(moduleIndex + 2), allowsBareName: false, ecosystem: "python", workingDirectories: [] }
      : undefined;
  }
  if (executable !== "node") return undefined;
  const nodeTestIndex = words.indexOf("--test");
  if (nodeTestIndex >= 0) {
    return {
      args: words.slice(nodeTestIndex + 1),
      allowsBareName: false,
      ecosystem: "javascript",
      workingDirectories: [],
    };
  }
  const cliIndex = words.findIndex((word) => /(?:^|\/)(?:vitest|jest)(?:\/|\.js$)/u.test(word));
  return cliIndex >= 0
    ? {
        args: testRunnerArgs(words.slice(cliIndex + 1)),
        allowsBareName: false,
        ecosystem: "javascript",
        workingDirectories: [],
      }
    : undefined;
}

function packageManagerTestInvocation(executable: string, words: readonly string[]): TestCommandInvocation | undefined {
  const index = packageSubcommandIndex(words, PACKAGE_OPTIONS_WITH_VALUE);
  const command = words[index];
  const scopeNarrowed = words
    .slice(1, index)
    .some((word) => [...PACKAGE_SCOPE_OPTIONS].some((option) => word === option || word.startsWith(`${option}=`)));
  if (command === "test") {
    return {
      args: packageRunnerArgs(words.slice(index + 1)),
      allowsBareName: false,
      ecosystem: "javascript",
      scopeNarrowed,
      workingDirectories: [],
    };
  }
  if (command === "run" && words[index + 1]?.startsWith("test")) {
    return {
      args: packageRunnerArgs(words.slice(index + 2)),
      allowsBareName: false,
      ecosystem: "javascript",
      scopeNarrowed,
      workingDirectories: [],
    };
  }
  if (executable === "npm" && command === "exec" && ["vitest", "jest"].includes(words[index + 1] ?? "")) {
    return {
      args: testRunnerArgs(packageRunnerArgs(words.slice(index + 2))),
      allowsBareName: false,
      ecosystem: "javascript",
      scopeNarrowed,
      workingDirectories: [],
    };
  }
  return undefined;
}

function packageSubcommandIndex(words: readonly string[], optionsWithValue: ReadonlySet<string>): number {
  let index = 1;
  while (words[index]?.startsWith("-") && words[index] !== "--") {
    const option = words[index]!;
    index += optionsWithValue.has(option) && !option.includes("=") ? 2 : 1;
  }
  return words[index] === "--" ? index + 1 : index;
}

function packageRunnerArgs(args: readonly string[]): string[] {
  return args[0] === "--" ? args.slice(1) : [...args];
}

function testRunnerArgs(args: readonly string[]): string[] {
  const normalized = packageRunnerArgs(args);
  return normalized[0] === "run" ? normalized.slice(1) : normalized;
}
