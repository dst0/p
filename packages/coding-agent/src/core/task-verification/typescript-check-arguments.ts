import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { typeScriptProjectsCoverSources } from "./typescript-project-scope.ts";

const NO_CHECK_OPTIONS = new Set([
  "all",
  "clean",
  "dry",
  "help",
  "h",
  "init",
  "listfilesonly",
  "nocheck",
  "showconfig",
  "version",
  "v",
]);
const OPTIONS_WITH_VALUE = new Set([
  "baseurl",
  "charset",
  "jsx",
  "jsximportsource",
  "lib",
  "locale",
  "module",
  "moduledetection",
  "moduleresolution",
  "modulesuffixes",
  "newline",
  "outdir",
  "outfile",
  "paths",
  "pretty",
  "reactnamespace",
  "rootdir",
  "rootdirs",
  "target",
  "tsbuildinfofile",
  "typeroots",
  "types",
]);
const PATH_OPTIONS = new Set(["baseurl", "outdir", "outfile", "rootdir", "rootdirs", "tsbuildinfofile", "typeroots"]);

export function isProjectWideTypecheck(
  arguments_: readonly string[],
  sessionRoot: string,
  cwd: string,
  sourcePaths: readonly string[],
): boolean {
  const build = arguments_.some((argument) => {
    const option = normalizeOption(splitOption(argument)[0]);
    return option === "b" || option === "build";
  });
  let noEmit = false;
  const operands: string[] = [];
  const projectPaths: string[] = [];
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (argument === "--") return false;
    if (!argument.startsWith("-")) {
      operands.push(argument);
      continue;
    }
    const [rawOption, inlineValue] = splitOption(argument);
    const option = normalizeOption(rawOption);
    if (NO_CHECK_OPTIONS.has(option) || (build && rawOption === "-d")) return false;
    if (option === "b" || option === "build") {
      continue;
    }
    if (option === "noemit") {
      noEmit = true;
      continue;
    }
    if (option === "p" || option === "project") {
      const value = inlineValue ?? arguments_[++index];
      if (!value) return false;
      const projectPath = boundProjectPath(value, sessionRoot, cwd);
      if (!projectPath) return false;
      projectPaths.push(projectPath);
      continue;
    }
    if (inlineValue !== undefined) {
      if (PATH_OPTIONS.has(option) && boundProjectPath(inlineValue, sessionRoot, cwd) === undefined) return false;
      continue;
    }
    if (OPTIONS_WITH_VALUE.has(option)) {
      const value = arguments_[++index];
      if (!value || (PATH_OPTIONS.has(option) && boundProjectPath(value, sessionRoot, cwd) === undefined)) return false;
    }
  }
  if (!build && operands.length > 0) return false;
  if (build) {
    for (const operand of operands) {
      const projectPath = boundProjectPath(operand, sessionRoot, cwd);
      if (!projectPath) return false;
      projectPaths.push(projectPath);
    }
  }
  if (!typeScriptProjectsCoverSources(projectPaths, sourcePaths, sessionRoot, cwd)) return false;
  return build || noEmit;
}

export function boundProjectPath(value: string, sessionRoot: string, cwd: string): string | undefined {
  if (!isStaticPath(value) || hasParentTraversal(value)) return undefined;
  const resolved = canonicalPath(resolve(cwd, value));
  const relativePath = relative(canonicalPath(sessionRoot), resolved);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath)) ? resolved : undefined;
}

function splitOption(argument: string): [string, string | undefined] {
  const separator = argument.indexOf("=");
  return separator < 0 ? [argument, undefined] : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function normalizeOption(option: string): string {
  return option.replace(/^-+/u, "").toLocaleLowerCase("en-US");
}

function isStaticPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("~") || /[$`*?{}()[\]<>;&|\0\r\n]/u.test(value)) return false;
  return process.platform === "win32" || !value.includes("\\");
}

function hasParentTraversal(value: string): boolean {
  return value.replaceAll("\\", "/").split("/").includes("..");
}

function canonicalPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return resolve(value);
  }
}
