import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import {
  BASELINE_METHODS,
  BASH_MUTATION_PATTERN,
  BUG_PATTERN,
  CHECKED_SOURCE_EXTENSIONS,
  DOCS_PATTERN,
  EXCLUDED_DIRS,
  FINAL_METHODS,
  INVESTIGATION_PATTERN,
  KNOWN_DIRECT_MUTATION_TOOLS,
  KNOWN_EVIDENCE_TOOLS,
  KNOWN_STATIC_TOOLS,
  REFACTOR_PATTERN,
  TASK_KINDS,
  USER_FILE_SIZE_OVERRIDE_PATTERN,
  WRITE_REDIRECT_PATTERN,
} from "./constants.ts";
import { containsGitPublishCommand, tokenizeShellCommands } from "./git-command-classification.ts";
import type { BaselineMethod, FinalMethod, TaskKind } from "./types.ts";

const CONFIDENTLY_READ_ONLY_SHELL_COMMANDS = new Set([
  "cat",
  "cmp",
  "diff",
  "file",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "shasum",
  "stat",
  "tail",
  "test",
  "wc",
  "which",
]);
const CONFIDENTLY_READ_ONLY_GIT_SUBCOMMANDS = new Set(["diff", "log", "show", "status"]);

export function findOversizedSourceFiles(
  cwd: string,
  taskText: string,
  mutatedFilePaths?: readonly string[],
  maxLines = 250,
): Array<{ path: string; lineCount: number }> {
  if (USER_FILE_SIZE_OVERRIDE_PATTERN.test(taskText)) {
    return [];
  }

  const oversizedFiles: Array<{ path: string; lineCount: number }> = [];

  const isExcludedPath = (fullPath: string, entry: string): boolean => {
    const rel = relative(cwd, fullPath).replace(/\\/g, "/");
    const parts = rel.split("/");
    for (let i = 0; i < parts.length; i++) {
      if (EXCLUDED_DIRS.has(parts[i]!)) return true;
    }
    if (
      entry.endsWith(".test.ts") ||
      entry.endsWith(".test.js") ||
      entry.endsWith(".test.tsx") ||
      entry.endsWith(".test.jsx") ||
      entry.endsWith(".spec.ts") ||
      entry.endsWith(".spec.js") ||
      entry.endsWith("_test.go") ||
      entry.startsWith("test_") ||
      entry.endsWith(".generated.ts") ||
      entry.endsWith(".d.ts")
    ) {
      return true;
    }
    return false;
  };

  const checkFile = (fullPath: string) => {
    const entry = fullPath.split(/[/\\]/).pop() || "";
    const ext = extname(entry).toLowerCase();
    if (!CHECKED_SOURCE_EXTENSIONS.has(ext)) return;
    if (isExcludedPath(fullPath, entry)) return;

    try {
      const content = readFileSync(fullPath, "utf-8");
      const lineCount = content.split("\n").length;
      if (lineCount > maxLines) {
        const relPath = relative(cwd, fullPath) || entry;
        oversizedFiles.push({ path: relPath, lineCount });
      }
    } catch {
      // ignore unreadable files
    }
  };

  if (mutatedFilePaths !== undefined) {
    for (const rawPath of mutatedFilePaths) {
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      try {
        const stat = statSync(absPath);
        if (stat.isFile()) {
          checkFile(absPath);
        }
      } catch {}
    }
    return oversizedFiles;
  }

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry) || entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          checkFile(fullPath);
        }
      } catch {}
    }
  }

  walk(cwd);
  return oversizedFiles;
}

export function isShellTool(toolName: string): boolean {
  return (
    toolName === "bash" ||
    toolName === "ctx_shell" ||
    toolName === "run_command" ||
    toolName === "exec" ||
    toolName === "shell" ||
    toolName === "terminal" ||
    toolName.endsWith("_shell")
  );
}

export function isEvidenceTool(toolName: string): boolean {
  if (KNOWN_EVIDENCE_TOOLS.has(toolName) || isShellTool(toolName)) return true;
  const lower = toolName.toLowerCase();
  return (
    lower.includes("read") ||
    lower.includes("grep") ||
    lower.includes("search") ||
    lower.includes("view") ||
    lower.includes("list") ||
    lower.includes("glob")
  );
}

export function isStaticTool(toolName: string): boolean {
  if (KNOWN_STATIC_TOOLS.has(toolName)) return true;
  if (isShellTool(toolName)) return false;
  const lower = toolName.toLowerCase();
  return (
    lower.includes("read") ||
    lower.includes("grep") ||
    lower.includes("search") ||
    lower.includes("view") ||
    lower.includes("list") ||
    lower.includes("glob")
  );
}

export function isDirectMutationTool(toolName: string): boolean {
  if (KNOWN_DIRECT_MUTATION_TOOLS.has(toolName)) return true;
  const lower = toolName.toLowerCase();
  return lower.includes("edit") || lower.includes("write") || lower.includes("patch") || lower.includes("replace");
}

export function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function normalizeStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeText).filter(Boolean))];
}

export function inferTaskKind(taskText: string): TaskKind {
  if (BUG_PATTERN.test(taskText)) return "bug_fix";
  if (REFACTOR_PATTERN.test(taskText)) return "refactor";
  if (DOCS_PATTERN.test(taskText)) return "docs";
  if (INVESTIGATION_PATTERN.test(taskText)) return "investigation";
  return "feature";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

export function isBaselineMethod(value: unknown): value is BaselineMethod {
  return typeof value === "string" && (BASELINE_METHODS as readonly string[]).includes(value);
}

export function isFinalMethod(value: unknown): value is FinalMethod {
  return typeof value === "string" && (FINAL_METHODS as readonly string[]).includes(value);
}

export function argsRecord(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {};
}

export function shellCommand(args: unknown): string {
  const rec = argsRecord(args);
  const value = rec.command ?? rec.cmd ?? rec.script ?? rec.code ?? rec.CommandLine;
  return typeof value === "string" ? value.trim() : "";
}

export function isPublishCommand(toolName: string, args: unknown): boolean {
  return isShellTool(toolName) && containsGitPublishCommand(shellCommand(args));
}

export function isRecognizedBashMutation(args: unknown): boolean {
  const command = shellCommand(args);
  return BASH_MUTATION_PATTERN.test(command) || WRITE_REDIRECT_PATTERN.test(command);
}

export function isPotentialMutationTool(toolName: string, args: unknown): boolean {
  if (isDirectMutationTool(toolName)) return true;
  if (isShellTool(toolName) && !isPublishCommand(toolName, args)) {
    return isRecognizedBashMutation(args);
  }
  return false;
}

export function isConfidentlyReadOnlyShellTool(toolName: string, args: unknown): boolean {
  if (!isShellTool(toolName)) return false;
  const command = shellCommand(args);
  if (!command || /[\n\r`$()<>]/u.test(command)) return false;
  const commands = tokenizeShellCommands(command);
  if (commands.length === 0) return false;
  return commands.every((words) => {
    const executable = words[0];
    if (!executable || executable.includes("/") || executable.includes("\\")) return false;
    const name = executable.toLocaleLowerCase("en-US");
    if (name === "find" && words.some((word) => /^-(?:delete|exec|execdir|ok|okdir)$/u.test(word))) return false;
    if (name === "rg" && words.some((word) => word === "--pre" || word.startsWith("--pre="))) return false;
    if (
      name === "file" &&
      words.slice(1).some((word) => word === "--compile" || (/^-[^-]*C/u.test(word) && word !== "-"))
    ) {
      return false;
    }
    if (name === "diff" && words.slice(1).some((word) => word === "--output" || word.startsWith("--output="))) {
      return false;
    }
    if (name === "git") {
      const subcommand = words[1]?.toLocaleLowerCase("en-US");
      const unsafeOption = words
        .slice(2)
        .some(
          (word) =>
            word === "--output" || word.startsWith("--output=") || word === "--ext-diff" || word === "--textconv",
        );
      return subcommand !== undefined && CONFIDENTLY_READ_ONLY_GIT_SUBCOMMANDS.has(subcommand) && !unsafeOption;
    }
    return CONFIDENTLY_READ_ONLY_SHELL_COMMANDS.has(name);
  });
}

export function pathArgument(args: unknown): string | undefined {
  const rec = argsRecord(args);
  const value =
    rec.path ?? rec.TargetFile ?? rec.targetFile ?? rec.target_file ?? rec.filePath ?? rec.file ?? rec.TargetDirectory;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function describeToolCall(toolName: string, args: unknown): string {
  if (isShellTool(toolName)) return shellCommand(args) || toolName;
  const values = argsRecord(args);
  const detail = pathArgument(args) ?? (typeof values.query === "string" ? values.query : "");
  return detail ? `${toolName} ${detail}` : toolName;
}

export function summarizeOutput(content: AfterToolCallContext["result"]["content"]): string {
  const value = content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return value.length <= 500 ? value : `${value.slice(0, 499).trimEnd()}…`;
}
