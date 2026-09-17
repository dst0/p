import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { directTypecheckCommand } from "./node-typecheck-command.ts";
import { packageTypecheckTarget } from "./package-check-command.ts";
import { focusedShellInvocation } from "./taskverificationcontroller-methods/focused-shell-command.ts";

const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=/u;
const SAFE_ENVIRONMENT = new Set(["CI", "FORCE_COLOR", "NO_COLOR"]);
const MAX_SCRIPT_DEPTH = 4;

export function isAuthoritativeTypecheckCommand(
  command: string,
  sessionCwd: string,
  sourcePaths: readonly string[] = [],
): boolean {
  const sessionRoot = canonicalPath(sessionCwd);
  return classifyAtDepth(command, sessionRoot, sessionRoot, sourcePaths, 0);
}

function classifyAtDepth(
  command: string,
  sessionRoot: string,
  cwd: string,
  sourcePaths: readonly string[],
  depth: number,
): boolean {
  if (depth > MAX_SCRIPT_DEPTH || command.includes("$'")) return false;
  const invocation = focusedShellInvocation(command);
  if (!invocation) return false;
  const effectiveCwd = invocation.workingDirectory
    ? boundWorkingDirectory(invocation.workingDirectory, sessionRoot, cwd)
    : cwd;
  if (!effectiveCwd) return false;
  const words = unwrapSafeEnvironment(invocation.words);
  if (!words || words.length === 0) return false;
  if (words[0] === "time")
    return words.length > 1 && classifyWords(words.slice(1), sessionRoot, effectiveCwd, sourcePaths, depth);
  return classifyWords(words, sessionRoot, effectiveCwd, sourcePaths, depth);
}

function classifyWords(
  words: readonly string[],
  sessionRoot: string,
  cwd: string,
  sourcePaths: readonly string[],
  depth: number,
): boolean {
  const packageTarget = packageTypecheckTarget(words, sessionRoot, cwd);
  if (!packageTarget) return directTypecheckCommand(words, sessionRoot, cwd, sourcePaths);
  if (packageTarget.kind === "compiler")
    return directTypecheckCommand(packageTarget.words, sessionRoot, packageTarget.cwd, sourcePaths);
  return classifyAtDepth(packageTarget.command, sessionRoot, packageTarget.cwd, sourcePaths, depth + 1);
}

function unwrapSafeEnvironment(words: readonly string[]): string[] | undefined {
  let index = 0;
  while (safeAssignment(words[index])) index += 1;
  while (index < words.length) {
    const executable = words[index];
    if (executable === "command") {
      index += 1;
      if (words[index] === "--") index += 1;
      else if (words[index]?.startsWith("-")) return undefined;
      if (ASSIGNMENT_PATTERN.test(words[index] ?? "")) return undefined;
      continue;
    }
    if (executable !== "env") break;
    index += 1;
    if (words[index] === "--") index += 1;
    else if (words[index]?.startsWith("-")) return undefined;
    while (safeAssignment(words[index])) index += 1;
    if (words[index]?.startsWith("-")) return undefined;
  }
  return words.slice(index);
}

function safeAssignment(value: string | undefined): boolean {
  const name = value === undefined ? undefined : ASSIGNMENT_PATTERN.exec(value)?.[1];
  if (name === undefined) return false;
  return SAFE_ENVIRONMENT.has(name.toLocaleUpperCase("en-US"));
}

function boundWorkingDirectory(value: string, sessionRoot: string, cwd: string): string | undefined {
  if (process.platform !== "win32" && value.includes("\\")) return undefined;
  if (value.replaceAll("\\", "/").split("/").includes("..")) return undefined;
  const target = canonicalPath(resolve(cwd, value));
  const relativePath = relative(canonicalPath(sessionRoot), target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath)) ? target : undefined;
}

function canonicalPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return resolve(value);
  }
}
