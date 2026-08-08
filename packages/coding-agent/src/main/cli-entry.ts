import { createInterface } from "node:readline";
import type { ImageContent } from "@dst0/p-ai";
import chalk from "chalk";
import type { Args, Mode } from "../cli/args.ts";
import { processFileArguments } from "../cli/file-processor.ts";
import { buildInitialMessage } from "../cli/initial-message.ts";
import type { AgentSessionRuntimeDiagnostic } from "../core/agent-session-services.ts";
import type { AppMode } from "../core/project-trust.ts";
import { SessionManager } from "../core/session-manager.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import type { ResolvedSession } from "./types.ts";

export async function readPipedStdin(): Promise<string | undefined> {
  // If stdin is a TTY, we're running interactively - don't read stdin
  if (process.stdin.isTTY) {
    return undefined;
  }

  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim() || undefined);
    });
    process.stdin.resume();
  });
}

export function collectSettingsDiagnostics(
  settingsManager: SettingsManager,
  context: string,
): AgentSessionRuntimeDiagnostic[] {
  return settingsManager.drainErrors().map(({ scope, error }) => ({
    type: "warning",
    message: `(${context}, ${scope} settings) ${error.message}`,
  }));
}

export function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const color = diagnostic.type === "error" ? chalk.red : diagnostic.type === "warning" ? chalk.yellow : chalk.dim;
    const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
    console.error(color(`${prefix}${diagnostic.message}`));
  }
}

export function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function resolveAppMode(parsed: Args, stdinIsTTY: boolean, stdoutIsTTY: boolean): AppMode {
  if (parsed.mode === "rpc") {
    return "rpc";
  }
  if (parsed.mode === "json") {
    return "json";
  }
  if (parsed.print || !stdinIsTTY || !stdoutIsTTY) {
    return "print";
  }
  return "interactive";
}

export function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
  return appMode === "json" ? "json" : "text";
}

export function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
  return !parsed.print && parsed.mode === undefined && (parsed.help === true || parsed.listModels !== undefined);
}

export async function prepareInitialMessage(
  parsed: Args,
  autoResizeImages: boolean,
  stdinContent?: string,
): Promise<{
  initialMessage?: string;
  initialImages?: ImageContent[];
}> {
  if (parsed.fileArgs.length === 0) {
    return buildInitialMessage({ parsed, stdinContent });
  }

  const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
  return buildInitialMessage({
    parsed,
    fileText: text,
    fileImages: images,
    stdinContent,
  });
}

export async function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
): Promise<{ type: "local"; path: string } | undefined> {
  const localSessions = sessionDir
    ? await SessionManager.listAll(sessionDir)
    : await SessionManager.list(cwd, sessionDir);
  const localMatch = localSessions.find((s) => s.id === sessionId);
  return localMatch ? { type: "local", path: localMatch.path } : undefined;
}

export async function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
): Promise<ResolvedSession> {
  // If it looks like a file path, resolve it before handing it to the session manager.
  if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
    return { type: "path", path: resolvePath(sessionArg, cwd) };
  }

  // Try to match as session ID in current project first
  const localSessions = await SessionManager.list(cwd, sessionDir);
  const localMatch =
    localSessions.find((s) => s.id === sessionArg) ?? localSessions.find((s) => s.id.startsWith(sessionArg));

  if (localMatch) {
    return { type: "local", path: localMatch.path };
  }

  // Try global search across all projects
  const allSessions = await SessionManager.listAll(sessionDir);
  const globalMatch =
    allSessions.find((s) => s.id === sessionArg) ?? allSessions.find((s) => s.id.startsWith(sessionArg));

  if (globalMatch) {
    return { type: "global", path: globalMatch.path, cwd: globalMatch.cwd };
  }

  // Not found anywhere
  return { type: "not_found", arg: sessionArg };
}

export async function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export function validateForkFlags(parsed: Args): void {
  if (!parsed.fork) return;

  const conflictingFlags = [
    parsed.session ? "--session" : undefined,
    parsed.continue ? "--continue" : undefined,
    parsed.resume ? "--resume" : undefined,
    parsed.noSession ? "--no-session" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    console.error(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
    process.exit(1);
  }
}
