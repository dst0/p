import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { boundProjectPath } from "./typescript-check-arguments.ts";

const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn"]);
const DIRECTORY_OPTIONS = new Set(["-C", "--cwd", "--dir", "--prefix"]);
const SAFE_FLAGS = new Set(["--offline", "--prefer-offline", "--silent"]);
const REJECTED_SCOPE_OPTIONS = new Set(["-F", "--filter", "--workspace", "--workspace-root"]);

export type PackageTypecheckTarget =
  | { cwd: string; kind: "compiler"; words: string[] }
  | { command: string; cwd: string; kind: "script" };

export function packageTypecheckTarget(
  words: readonly string[],
  sessionRoot: string,
  cwd: string,
): PackageTypecheckTarget | undefined {
  const runner = words[0];
  if (!runner || runner.includes("/") || runner.includes("\\") || !PACKAGE_RUNNERS.has(runner)) return undefined;
  const parsed = parseRunnerOptions(words, sessionRoot, cwd);
  if (!parsed) return undefined;
  const action = words[parsed.index];
  if (!action) return undefined;
  if (action === "exec") {
    if (runner === "npm") return undefined;
    const compilerWords = words.slice(parsed.index + 1);
    return compilerWords.length > 0 ? { cwd: parsed.cwd, kind: "compiler", words: compilerWords } : undefined;
  }
  const scriptIndex = action === "run" ? parsed.index + 1 : parsed.index;
  const scriptName = words[scriptIndex];
  if (!scriptName || scriptName.startsWith("-") || words.length !== scriptIndex + 1) return undefined;
  const command = packageScript(parsed.cwd, scriptName, sessionRoot);
  return command === undefined ? undefined : { command, cwd: parsed.cwd, kind: "script" };
}

function parseRunnerOptions(
  words: readonly string[],
  sessionRoot: string,
  initialCwd: string,
): { cwd: string; index: number } | undefined {
  let cwd = initialCwd;
  let index = 1;
  let directoryBound = false;
  while (index < words.length) {
    const option = words[index]!;
    if (!option.startsWith("-")) break;
    if (option === "--" || REJECTED_SCOPE_OPTIONS.has(option) || hasRejectedInlineScope(option)) return undefined;
    const inlineDirectory = directoryOptionValue(option);
    if (inlineDirectory !== undefined) {
      if (directoryBound) return undefined;
      const nextCwd = boundProjectPath(inlineDirectory, sessionRoot, cwd);
      if (!nextCwd) return undefined;
      cwd = nextCwd;
      directoryBound = true;
      index += 1;
      continue;
    }
    if (DIRECTORY_OPTIONS.has(option)) {
      if (directoryBound) return undefined;
      const nextCwd = boundProjectPath(words[index + 1] ?? "", sessionRoot, cwd);
      if (!nextCwd) return undefined;
      cwd = nextCwd;
      directoryBound = true;
      index += 2;
      continue;
    }
    if (!SAFE_FLAGS.has(option)) return undefined;
    index += 1;
  }
  return { cwd, index };
}

function directoryOptionValue(option: string): string | undefined {
  for (const name of DIRECTORY_OPTIONS) {
    if (option.startsWith(`${name}=`)) return option.slice(name.length + 1);
  }
  return undefined;
}

function hasRejectedInlineScope(option: string): boolean {
  return [...REJECTED_SCOPE_OPTIONS].some((name) => option.startsWith(`${name}=`));
}

function packageScript(cwd: string, scriptName: string, sessionRoot: string): string | undefined {
  try {
    const manifestPath = resolve(cwd, "package.json");
    if (lstatSync(manifestPath).isSymbolicLink()) return undefined;
    const realManifest = realpathSync.native(manifestPath);
    const relativePath = relative(realpathSync.native(sessionRoot), realManifest);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
    const manifest: unknown = JSON.parse(readFileSync(realManifest, "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return undefined;
    if (manifest.scripts[`pre${scriptName}`] !== undefined || manifest.scripts[`post${scriptName}`] !== undefined) {
      return undefined;
    }
    const script = manifest.scripts[scriptName];
    return typeof script === "string" && script.trim().length > 0 ? script : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
