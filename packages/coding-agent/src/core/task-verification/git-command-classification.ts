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

function isExecutable(token: string | undefined, name: string): boolean {
  return token === name || token?.endsWith(`/${name}`) === true;
}

function tokenizeShellCommands(command: string): string[][] {
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

function gitArgumentStart(words: readonly string[]): number | undefined {
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
  const executable = words[index];
  return isExecutable(executable, "git") ? index + 1 : undefined;
}

function envSplitStringPayload(words: readonly string[]): string | undefined {
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

export function containsGitPublishCommand(command: string): boolean {
  return containsGitPublishCommandAtDepth(command, 0);
}
