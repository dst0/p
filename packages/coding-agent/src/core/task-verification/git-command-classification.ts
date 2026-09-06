const GIT_OPTIONS_WITH_SEPARATE_VALUE = new Set([
  "-C",
  "-c",
  "--config-env",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
]);
const ENV_OPTIONS_WITH_SEPARATE_VALUE = new Set([
  "-a",
  "--argv0",
  "-C",
  "--chdir",
  "-S",
  "--split-string",
  "-u",
  "--unset",
]);
const SHELL_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const MAX_SPLIT_STRING_DEPTH = 4;
const GIT_ACTIONS = new Set([
  "add",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "diff",
  "fetch",
  "log",
  "merge",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "show",
  "stash",
  "status",
  "switch",
  "tag",
]);
function isExecutable(token: string | undefined, name: string): boolean {
  return token === name || token?.endsWith(`/${name}`) === true;
}

export function tokenizeShellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const finishWord = (): void => {
    if (!wordStarted) return;
    words.push(word);
    word = "";
    wordStarted = false;
  };
  const finishCommand = (): void => {
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
      if (character === quote) {
        quote = undefined;
      } else if (character === "\\" && quote === '"') {
        escaped = true;
      } else {
        word += character;
      }
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

export function commandStart(words: readonly string[]): number {
  let index = 0;
  while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
  while (isExecutable(words[index], "command") || isExecutable(words[index], "env")) {
    const wrapper = words[index++];
    if (isExecutable(wrapper, "command")) {
      while (words[index]?.startsWith("-")) index += 1;
    } else {
      while (index < words.length) {
        const token = words[index]!;
        if (token === "--" || token === "-") {
          index += 1;
          break;
        }
        if (ENV_OPTIONS_WITH_SEPARATE_VALUE.has(token)) {
          index += 2;
        } else if (token.startsWith("-") || SHELL_ASSIGNMENT_PATTERN.test(token)) {
          index += 1;
        } else {
          break;
        }
      }
    }
    while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
  }
  return index;
}

export function gitArgumentStart(words: readonly string[]): number | undefined {
  const index = commandStart(words);
  return isExecutable(words[index], "git") ? index + 1 : undefined;
}

export function gitAction(words: readonly string[], startIndex: number): string | undefined {
  for (let index = startIndex; index < words.length; index++) {
    const token = words[index]!;
    if (token === "--") return words[index + 1]?.toLocaleLowerCase("en-US");
    if (GIT_OPTIONS_WITH_SEPARATE_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    const normalized = token.toLocaleLowerCase("en-US");
    return GIT_ACTIONS.has(normalized) ? normalized : undefined;
  }
  return undefined;
}

export function shellWrapperPayload(words: readonly string[]): string | undefined {
  const startIndex = commandStart(words);
  const executable = words[startIndex]?.split("/").pop();
  if (executable === "eval") return words.slice(startIndex + 1).join(" ") || undefined;
  if (executable !== "bash" && executable !== "sh" && executable !== "zsh") return undefined;
  const commandIndex = words.findIndex(
    (word, index) => index > startIndex && (word === "-c" || /^-[^-]*c[^-]*$/u.test(word)),
  );
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined;
}

export function envSplitStringPayload(words: readonly string[]): string | undefined {
  let index = 0;
  while (index < words.length) {
    while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
    if (isExecutable(words[index], "command")) {
      index += 1;
      while (words[index]?.startsWith("-")) index += 1;
      continue;
    }
    if (!isExecutable(words[index], "env")) return undefined;
    index += 1;
    while (index < words.length) {
      const token = words[index]!;
      if (token === "-S" || token === "--split-string") return words[index + 1];
      if (token.startsWith("--split-string=")) return token.slice("--split-string=".length);
      if (token.startsWith("-S") && token.length > 2) return token.slice(2);
      if (token === "--" || token === "-") {
        index += 1;
        break;
      }
      if (ENV_OPTIONS_WITH_SEPARATE_VALUE.has(token)) {
        index += 2;
      } else if (token.startsWith("-") || SHELL_ASSIGNMENT_PATTERN.test(token)) {
        index += 1;
      } else {
        break;
      }
    }
  }
  return undefined;
}

function invocationPublishes(words: readonly string[], startIndex: number): boolean {
  for (let index = startIndex; index < words.length; index++) {
    const token = words[index]!;
    if (token === "commit" || token === "push") return true;
    if (!token.startsWith("-")) return false;
    if (GIT_OPTIONS_WITH_SEPARATE_VALUE.has(token)) index += 1;
  }
  return false;
}

function containsGitPublishCommandAtDepth(command: string, depth: number): boolean {
  for (const words of tokenizeShellCommands(command)) {
    const shellPayload = shellWrapperPayload(words);
    if (shellPayload !== undefined) {
      if (depth >= MAX_SPLIT_STRING_DEPTH) return true;
      if (containsGitPublishCommandAtDepth(shellPayload, depth + 1)) return true;
    }
    const splitStringPayload = envSplitStringPayload(words);
    if (splitStringPayload !== undefined) {
      if (depth >= MAX_SPLIT_STRING_DEPTH) return true;
      if (containsGitPublishCommandAtDepth(splitStringPayload, depth + 1)) return true;
    }
    const startIndex = gitArgumentStart(words);
    if (startIndex !== undefined && invocationPublishes(words, startIndex)) return true;
  }
  return false;
}

function isDirectoryChange(words: readonly string[]): boolean {
  if (!isExecutable(words[0], "cd")) return false;
  return words.length === 2 || (words.length === 3 && words[1] === "--");
}

function isSafePublishCommandSequenceAtDepth(command: string, depth: number): boolean {
  if (/[<>`]|\$\(/u.test(command)) return false;
  const commands = tokenizeShellCommands(command);
  if (commands.length === 0) return false;
  let foundPublish = false;
  for (const words of commands) {
    const shellPayload = shellWrapperPayload(words);
    if (shellPayload !== undefined) {
      if (depth >= MAX_SPLIT_STRING_DEPTH || !isSafePublishCommandSequenceAtDepth(shellPayload, depth + 1)) {
        return false;
      }
      foundPublish = true;
      continue;
    }
    const splitStringPayload = envSplitStringPayload(words);
    if (splitStringPayload !== undefined) {
      if (depth >= MAX_SPLIT_STRING_DEPTH || !isSafePublishCommandSequenceAtDepth(splitStringPayload, depth + 1)) {
        return false;
      }
      foundPublish = true;
      continue;
    }
    const startIndex = gitArgumentStart(words);
    if (startIndex !== undefined && invocationPublishes(words, startIndex)) {
      foundPublish = true;
      continue;
    }
    if (!isDirectoryChange(words)) return false;
  }
  return foundPublish;
}

export function containsGitPublishCommand(command: string): boolean {
  return containsGitPublishCommandAtDepth(command, 0);
}

export function isSafePublishCommandSequence(command: string): boolean {
  return isSafePublishCommandSequenceAtDepth(command, 0);
}
