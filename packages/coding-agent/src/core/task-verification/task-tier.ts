import { extname } from "node:path";
import { CHECKED_SOURCE_EXTENSIONS, TEST_PATH_PATTERN } from "./constants.ts";
import { requestedEffectIntent } from "./requested-effect-intent.ts";
import { inferTaskKind } from "./task-kind-inference.ts";
import type { TaskKind } from "./types.ts";
import type { TaskVerificationPolicy } from "./verification-policy.ts";

/** LIGHT answers without verification ceremony; STRICT runs the evidence engine. */
export type VerificationTier = "light" | "strict";

export const VERIFICATION_TIER_REASONS = [
  "default",
  "prior",
  "model_declared",
  "effect_source",
  "effect_test",
  "effect_config",
  "effect_untracked",
  "user_override",
] as const;
export type VerificationTierReason = (typeof VERIFICATION_TIER_REASONS)[number];

export interface VerificationTierDecision {
  tier: VerificationTier;
  reason: VerificationTierReason;
  trigger?: string;
}

export type EffectPathClass = "source" | "test" | "config" | "docs" | "other";

/**
 * Default tools deferred behind tool_search while LIGHT; STRICT restores the ones the session started with.
 * Compiled project-instruction readers stay active because their catalog is part of the system prompt.
 */
export const LIGHT_DEFERRED_TOOL_NAMES: readonly string[] = [
  "process",
  "sleep",
  "update_session_state",
  "mark_session_progress",
  "session_recall",
  "keep_context",
];

const STRICT_PRIOR_TASK_KINDS: ReadonlySet<TaskKind> = new Set(["bug_fix", "behavior_change", "refactor", "feature"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".rst", ".adoc", ".txt"]);
const EXTRA_CODE_EXTENSIONS = new Set([
  ".mts",
  ".cts",
  ".css",
  ".scss",
  ".html",
  ".tf",
  ".proto",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
  ".scala",
  ".lua",
  ".dart",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".ml",
  ".clj",
  ".jl",
  ".zig",
  ".pl",
  ".pm",
  ".r",
  ".m",
  ".mm",
]);
/** Never hand-written, wherever they appear. */
const GENERATED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  "target",
  "__pycache__",
  ".venv",
]);
/** Generated or vendored only at the repository root; `src/build/` is ordinary source. */
const ROOT_GENERATED_DIRECTORIES = new Set(["build", "out", "vendor"]);
const BUILD_CONFIG_FILE_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lockb",
  "tsconfig.json",
  "jsconfig.json",
  "biome.json",
  "deno.json",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "pyproject.toml",
  "setup.cfg",
  "poetry.lock",
  "pipfile",
  "pipfile.lock",
  "gemfile",
  "gemfile.lock",
  "makefile",
  "cmakelists.txt",
  "dockerfile",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "pom.xml",
  "justfile",
  ".npmrc",
]);
const BUILD_CONFIG_PATH_PATTERN =
  /(?:^|\/)(?:tsconfig\.[^/]+\.json|requirements[^/]*\.txt|[^/]+\.csproj|dockerfile\.[^/]+)$|(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(?:^|\/)\.gitlab-ci\.ya?ml$/u;
const TEST_FILE_NAME_PATTERN = /^test_[^/]+\.py$|_test\.(?:go|py|rb|exs?)$|_spec\.rb$/u;

/** Deterministic prior: code-changing task kinds with a required effect start STRICT. */
export function promptRequiresStrictTier(promptText: string): boolean {
  const text = promptText.trim();
  if (!text || requestedEffectIntent([text]) !== "effect_required") return false;
  const kind = inferTaskKind(text);
  return kind !== undefined && STRICT_PRIOR_TASK_KINDS.has(kind);
}

/** Tier for a new, non-nudge user prompt under a policy other than `off`. */
export function initialVerificationTier(
  policy: Exclude<TaskVerificationPolicy, "off">,
  promptText: string,
): VerificationTierDecision {
  if (policy === "light") return { tier: "light", reason: "user_override" };
  if (policy === "strict") return { tier: "strict", reason: "user_override" };
  return { tier: promptRequiresStrictTier(promptText) ? "strict" : "light", reason: "prior" };
}

/** Classifies a task-owned workspace path for the effect backstop. */
export function classifyEffectPath(filePath: string): EffectPathClass {
  const lower = filePath.replaceAll("\\", "/").replace(/^\.\//u, "").toLowerCase();
  const segments = lower.split("/");
  const name = segments.at(-1) ?? "";
  if (segments.some((segment) => GENERATED_DIRECTORIES.has(segment))) return "other";
  const rootEnd = lower.indexOf("/");
  if (rootEnd > 0 && ROOT_GENERATED_DIRECTORIES.has(lower.slice(0, rootEnd))) return "other";
  if (BUILD_CONFIG_FILE_NAMES.has(name) || BUILD_CONFIG_PATH_PATTERN.test(lower)) return "config";
  const extension = extname(name);
  if (DOC_EXTENSIONS.has(extension)) return "docs";
  const code = CHECKED_SOURCE_EXTENSIONS.has(extension) || EXTRA_CODE_EXTENSIONS.has(extension);
  if (TEST_PATH_PATTERN.test(lower) || TEST_FILE_NAME_PATTERN.test(name)) return code ? "test" : "other";
  if (segments.slice(0, -1).includes("docs")) return code ? "source" : "docs";
  return code ? "source" : "other";
}

/**
 * Effect backstop: only a concrete filesystem change to source, test, or build-config paths escalates.
 * Documentation and other artifacts, searches, and extension or MCP effects stay LIGHT.
 */
export function effectEscalation(newPaths: readonly string[]): VerificationTierDecision | undefined {
  for (const pathClass of ["source", "test", "config"] as const) {
    const path = newPaths.find((candidate) => classifyEffectPath(candidate) === pathClass);
    if (path) return { tier: "strict", reason: `effect_${pathClass}`, trigger: path };
  }
  return undefined;
}

/** Whether every owned path stays within LIGHT (documentation or non-code artifacts). */
export function pathsAreLightCompatible(paths: readonly string[]): boolean {
  return paths.every((path) => {
    const pathClass = classifyEffectPath(path);
    return pathClass === "docs" || pathClass === "other";
  });
}
