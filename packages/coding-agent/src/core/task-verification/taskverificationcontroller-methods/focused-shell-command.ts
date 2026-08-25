import { tokenizeShellCommands } from "../git-command-classification.ts";

type ShellConnector = "&&" | "||" | ";" | "&" | "|" | "newline";

interface ShellShape {
  connectors: ShellConnector[];
  segments: string[];
}

export interface FocusedShellInvocation {
  words: string[];
  workingDirectory?: string;
}

const NON_LITERAL_DIRECTORY_CHARACTERS = new Set([
  "$",
  "`",
  "*",
  "?",
  "[",
  "]",
  "{",
  "}",
  "(",
  ")",
  "<",
  ">",
  ";",
  "&",
  "|",
]);

export function focusedShellInvocationWords(command: string): string[] | undefined {
  return focusedShellInvocation(command)?.words;
}

export function focusedShellInvocation(command: string): FocusedShellInvocation | undefined {
  const withoutRedirection = command.replace(/\s+2>&1\s*$/u, "");
  const shape = splitTopLevelShell(withoutRedirection);
  if (shape === undefined) return undefined;
  if (shape.connectors.length === 0) {
    const words = singleInvocationWords(shape.segments[0]!);
    return words === undefined ? undefined : { words };
  }
  if (shape.connectors.length !== 1 || shape.connectors[0] !== "&&") return undefined;
  const directoryWords = singleInvocationWords(shape.segments[0]!);
  const workingDirectory = directoryWords === undefined ? undefined : literalDirectoryChange(directoryWords);
  const words = singleInvocationWords(shape.segments[1]!);
  return workingDirectory === undefined || words === undefined ? undefined : { words, workingDirectory };
}

function singleInvocationWords(command: string): string[] | undefined {
  const invocations = tokenizeShellCommands(command);
  return invocations.length === 1 ? invocations[0] : undefined;
}

function literalDirectoryChange(words: readonly string[]): string | undefined {
  if (words[0]?.split("/").pop() !== "cd") return undefined;
  const pathIndex = words[1] === "--" ? 2 : 1;
  const path = words[pathIndex];
  if (!path || words.length !== pathIndex + 1 || path.startsWith("-") || path.startsWith("~")) return undefined;
  return [...path].some((character) => NON_LITERAL_DIRECTORY_CHARACTERS.has(character)) ? undefined : path;
}

function splitTopLevelShell(command: string): ShellShape | undefined {
  const segments: string[] = [];
  const connectors: ShellConnector[] = [];
  let segmentStart = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const addConnector = (connector: ShellConnector, index: number, width: number): boolean => {
    const segment = command.slice(segmentStart, index).trim();
    if (segment.length === 0) return false;
    segments.push(segment);
    connectors.push(connector);
    segmentStart = index + width;
    return true;
  };

  for (let index = 0; index < command.length; index++) {
    const character = command[index]!;
    const next = command[index + 1];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"') escaped = true;
      else if (quote !== "'" && (character === "`" || (character === "$" && next === "("))) return undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`" || (character === "$" && next === "(")) return undefined;
    if (character === "#" && (index === 0 || /\s/u.test(command[index - 1]!))) return undefined;
    if (character === "<" || character === ">" || character === "(" || character === ")") return undefined;
    if (character === "\n" || character === "\r") {
      if (!addConnector("newline", index, 1)) return undefined;
    } else if (character === ";") {
      if (!addConnector(";", index, 1)) return undefined;
    } else if (character === "&") {
      const width = next === "&" ? 2 : 1;
      if (!addConnector(width === 2 ? "&&" : "&", index, width)) return undefined;
      index += width - 1;
    } else if (character === "|") {
      const width = next === "|" ? 2 : 1;
      if (!addConnector(width === 2 ? "||" : "|", index, width)) return undefined;
      index += width - 1;
    }
  }
  if (quote || escaped) return undefined;
  const finalSegment = command.slice(segmentStart).trim();
  if (finalSegment.length === 0) return undefined;
  segments.push(finalSegment);
  return { connectors, segments };
}
