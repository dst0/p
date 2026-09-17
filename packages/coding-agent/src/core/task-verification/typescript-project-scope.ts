import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_EXTENDS_DEPTH = 16;

interface LocatedPatterns {
  baseDirectory: string;
  patterns: string[];
}

interface EffectiveConfig {
  allowJs: boolean;
  configDirectory: string;
  exclude?: LocatedPatterns;
  files?: LocatedPatterns;
  include?: LocatedPatterns;
  outDirectory?: string;
}

interface RawConfig {
  compilerOptions?: unknown;
  exclude?: unknown;
  extends?: unknown;
  files?: unknown;
  include?: unknown;
}

export function typeScriptProjectsCoverSources(
  projectPaths: readonly string[],
  sourcePaths: readonly string[],
  sessionRoot: string,
  cwd: string,
): boolean {
  const relevantSourcePaths = sourcePaths.filter((sourcePath) => isTypeScript(sourcePath) || isJavaScript(sourcePath));
  if (relevantSourcePaths.length === 0) return true;
  const sources = relevantSourcePaths.map((sourcePath) => boundSourcePath(sourcePath, sessionRoot));
  if (sources.some((source) => source === undefined)) return false;
  const requestedProjects = projectPaths.length > 0 ? projectPaths : [findNearestConfig(cwd, sessionRoot)];
  if (requestedProjects.some((projectPath) => projectPath === undefined)) return false;
  const cache = new Map<string, EffectiveConfig | undefined>();
  const projects = requestedProjects.map((projectPath) =>
    loadConfig(resolveProjectConfigPath(projectPath!), sessionRoot, cache, new Set(), 0),
  );
  if (projects.some((project) => project === undefined)) return false;
  return sources.every((source) => projects.some((project) => configCoversSource(project!, source!)));
}

function loadConfig(
  configPath: string | undefined,
  sessionRoot: string,
  cache: Map<string, EffectiveConfig | undefined>,
  ancestors: Set<string>,
  depth: number,
): EffectiveConfig | undefined {
  if (!configPath || depth > MAX_EXTENDS_DEPTH || ancestors.has(configPath)) return undefined;
  if (cache.has(configPath)) return cache.get(configPath);
  const raw = readConfig(configPath);
  if (!raw) return cache.set(configPath, undefined).get(configPath);
  const nextAncestors = new Set(ancestors).add(configPath);
  const configDirectory = dirname(configPath);
  let effective: EffectiveConfig = { allowJs: false, configDirectory };
  const extendedPaths = extendedConfigPaths(raw.extends, dirname(configPath), sessionRoot);
  if (!extendedPaths) return cache.set(configPath, undefined).get(configPath);
  for (const extendedPath of extendedPaths) {
    const extended = loadConfig(extendedPath, sessionRoot, cache, nextAncestors, depth + 1);
    if (!extended) return cache.set(configPath, undefined).get(configPath);
    effective = { ...effective, ...extended };
  }
  const own = ownConfig(raw, dirname(configPath));
  if (!own) return cache.set(configPath, undefined).get(configPath);
  effective = { ...effective, ...own, configDirectory };
  cache.set(configPath, effective);
  return effective;
}

function readConfig(configPath: string): RawConfig | undefined {
  try {
    const contents = readFileSync(configPath, "utf8");
    if (Buffer.byteLength(contents) > MAX_CONFIG_BYTES) return undefined;
    const sanitized = stripJsonCommentsAndTrailingCommas(contents);
    if (sanitized === undefined) return undefined;
    const parsed: unknown = JSON.parse(sanitized);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function ownConfig(raw: RawConfig, baseDirectory: string): Partial<EffectiveConfig> | undefined {
  const own: Partial<EffectiveConfig> = {};
  for (const key of ["files", "include", "exclude"] as const) {
    if (!(key in raw)) continue;
    const patterns = stringArray(raw[key]);
    if (!patterns) return undefined;
    own[key] = { baseDirectory, patterns };
  }
  if (!("compilerOptions" in raw)) return own;
  if (!isRecord(raw.compilerOptions)) return undefined;
  if ("allowJs" in raw.compilerOptions) {
    if (typeof raw.compilerOptions.allowJs !== "boolean") return undefined;
    own.allowJs = raw.compilerOptions.allowJs;
  }
  if ("outDir" in raw.compilerOptions) {
    if (typeof raw.compilerOptions.outDir !== "string") return undefined;
    own.outDirectory = resolve(baseDirectory, raw.compilerOptions.outDir);
  }
  return own;
}

function extendedConfigPaths(value: unknown, baseDirectory: string, sessionRoot: string): string[] | undefined {
  if (value === undefined) return [];
  const values = typeof value === "string" ? [value] : stringArray(value);
  if (!values) return undefined;
  const paths: string[] = [];
  for (const candidate of values) {
    if (!candidate.startsWith(".") && !isAbsolute(candidate)) return undefined;
    const configPath = resolveExtendedConfigPath(resolve(baseDirectory, candidate));
    if (!configPath || !isInside(sessionRoot, configPath)) return undefined;
    paths.push(configPath);
  }
  return paths;
}

function configCoversSource(config: EffectiveConfig, source: string): boolean {
  if (isJavaScript(source) && !config.allowJs) return false;
  const listed =
    config.files?.patterns.some((pattern) => resolve(config.files!.baseDirectory, pattern) === source) ?? false;
  if (listed) return true;
  const include =
    config.include ??
    (config.files === undefined ? { baseDirectory: config.configDirectory, patterns: ["**/*"] } : undefined);
  if (!include) return false;
  const included = include.patterns.some((pattern) =>
    matchesPattern(source, include.baseDirectory, pattern, isDirectoryInclude(pattern)),
  );
  if (!included) return false;
  if (defaultExcluded(source, include.baseDirectory)) return false;
  if (config.outDirectory && isInside(config.outDirectory, source)) return false;
  return !config.exclude?.patterns.some((pattern) =>
    matchesPattern(source, config.exclude!.baseDirectory, pattern, true),
  );
}

function matchesPattern(source: string, baseDirectory: string, pattern: string, directoryPattern: boolean): boolean {
  if (isAbsolute(pattern) || pattern.includes("\0")) return false;
  const relativeSource = relative(baseDirectory, source).replaceAll("\\", "/");
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (/[[\]]/u.test(normalized)) return false;
  const patterns = directoryPattern ? [normalized, `${normalized}/**/*`] : [normalized];
  return patterns.some((candidate) =>
    minimatch(relativeSource, candidate, {
      dot: false,
      nobrace: true,
      nocase: process.platform === "win32",
      noext: true,
      nonegate: true,
    }),
  );
}

function isDirectoryInclude(pattern: string): boolean {
  const lastSegment = pattern.replaceAll("\\", "/").replace(/\/$/u, "").split("/").at(-1) ?? "";
  return lastSegment.length > 0 && !/[.*?]/u.test(lastSegment);
}

function defaultExcluded(source: string, baseDirectory: string): boolean {
  const parts = relative(baseDirectory, source).replaceAll("\\", "/").split("/");
  return parts.some((part) => part === "node_modules" || part === "bower_components" || part === "jspm_packages");
}

function findNearestConfig(cwd: string, sessionRoot: string): string | undefined {
  let directory = cwd;
  while (isInside(sessionRoot, directory)) {
    const configPath = existingFile(join(directory, "tsconfig.json"));
    if (configPath) return configPath;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function resolveProjectConfigPath(projectPath: string): string | undefined {
  try {
    if (statSync(projectPath).isDirectory()) return existingFile(join(projectPath, "tsconfig.json"));
    return existingFile(projectPath);
  } catch {
    return undefined;
  }
}

function resolveExtendedConfigPath(projectPath: string): string | undefined {
  return (
    existingFile(projectPath) ?? existingFile(`${projectPath}.json`) ?? existingFile(join(projectPath, "tsconfig.json"))
  );
}

function existingFile(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? realpathSync.native(path) : undefined;
  } catch {
    return undefined;
  }
}

function boundSourcePath(sourcePath: string, sessionRoot: string): string | undefined {
  if (isAbsolute(sourcePath) || sourcePath.replaceAll("\\", "/").split("/").includes("..")) return undefined;
  const source = resolve(sessionRoot, sourcePath);
  if (!isInside(sessionRoot, source) || (!isTypeScript(source) && !isJavaScript(source))) return undefined;
  try {
    return realpathSync.native(source);
  } catch {
    return source;
  }
}

function isInside(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isTypeScript(path: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/iu.test(path);
}

function isJavaScript(path: string): boolean {
  return /\.(?:cjs|js|jsx|mjs)$/iu.test(path);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isRecord(value: unknown): value is RawConfig & Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonCommentsAndTrailingCommas(value: string): string | undefined {
  let result = "";
  let inString = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (inString) {
      result += character;
      if (character === "\\") result += value[++index] ?? "";
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && value[index + 1] === "/") {
      while (index < value.length && value[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && value[index + 1] === "*") {
      const commentEnd = value.indexOf("*/", index + 2);
      if (commentEnd < 0) return undefined;
      index = commentEnd + 1;
      continue;
    }
    result += character;
  }
  return removeTrailingCommas(result);
}

function removeTrailingCommas(value: string): string {
  let result = "";
  let inString = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (inString) {
      result += character;
      if (character === "\\") result += value[++index] ?? "";
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    if (character === "," && /^\s*[}\]]/u.test(value.slice(index + 1))) continue;
    result += character;
  }
  return result;
}
