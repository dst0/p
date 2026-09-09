import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { isProjectWideTypecheck } from "./typescript-check-arguments.ts";

const POSIX_COMPILERS = new Set(["tsc", "tsgo"]);
const WINDOWS_COMPILERS = new Set(["tsc", "tsc.cmd", "tsc.exe", "tsgo", "tsgo.cmd", "tsgo.exe"]);
const LOCAL_COMPILER_PATHS = new Set([
  "node_modules/.bin/tsc",
  "node_modules/.bin/tsgo",
  "node_modules/@typescript/native-preview/bin/tsgo",
  "node_modules/typescript/bin/tsc",
  "node_modules/typescript/bin/tsc.js",
]);

export function directTypecheckCommand(
  words: readonly string[],
  sessionRoot: string,
  cwd: string,
  sourcePaths: readonly string[],
): boolean {
  const executable = words[0];
  if (!executable) return false;
  if (isNodeExecutable(executable)) return nodeTypecheckCommand(words, sessionRoot, cwd, sourcePaths);
  if (!isCompilerExecutable(executable, sessionRoot, cwd)) return false;
  return isProjectWideTypecheck(words.slice(1), sessionRoot, cwd, sourcePaths);
}

function nodeTypecheckCommand(
  words: readonly string[],
  sessionRoot: string,
  cwd: string,
  sourcePaths: readonly string[],
): boolean {
  const compiler = words[1];
  if (!compiler || compiler.startsWith("-") || !isNodeCompilerPath(compiler, sessionRoot, cwd)) return false;
  return isProjectWideTypecheck(words.slice(2), sessionRoot, cwd, sourcePaths);
}

function isNodeExecutable(value: string): boolean {
  if (value.includes("/") || (process.platform !== "win32" && value.includes("\\"))) return false;
  return process.platform === "win32"
    ? value.toLocaleLowerCase("en-US") === "node.exe" || value === "node"
    : value === "node";
}

function isCompilerExecutable(value: string, sessionRoot: string, cwd: string): boolean {
  if (!value.includes("/") && !value.includes("\\")) {
    return process.platform === "win32"
      ? WINDOWS_COMPILERS.has(value.toLocaleLowerCase("en-US"))
      : POSIX_COMPILERS.has(value);
  }
  return localCompilerPath(value, sessionRoot, cwd) !== undefined;
}

function isNodeCompilerPath(value: string, sessionRoot: string, cwd: string): boolean {
  const normalized = localCompilerPath(value, sessionRoot, cwd);
  return normalized === "node_modules/typescript/bin/tsc" || normalized === "node_modules/typescript/bin/tsc.js";
}

function localCompilerPath(value: string, sessionRoot: string, cwd: string): string | undefined {
  if (process.platform !== "win32" && value.includes("\\")) return undefined;
  const slashValue = value.replaceAll("\\", "/");
  if (slashValue.split("/").includes("..")) return undefined;
  const resolved = resolve(cwd, value);
  let realCompiler: string;
  try {
    realCompiler = realpathSync.native(resolved);
  } catch {
    return undefined;
  }
  const relativeToRoot = relative(realpathSync.native(sessionRoot), realCompiler);
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) return undefined;
  const relativeToCwd = relative(resolve(cwd), resolved).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!LOCAL_COMPILER_PATHS.has(relativeToCwd)) return undefined;
  const realPath = relativeToRoot.replaceAll("\\", "/");
  if (relativeToCwd.endsWith("tsgo")) {
    return realPath.endsWith("node_modules/@typescript/native-preview/bin/tsgo") ? relativeToCwd : undefined;
  }
  return /(?:^|\/)node_modules\/typescript\/bin\/tsc(?:\.js)?$/u.test(realPath) ? relativeToCwd : undefined;
}
