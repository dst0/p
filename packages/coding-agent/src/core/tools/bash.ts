import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool } from "@dst0/p-agent-core";
import { Container, Text, truncateToWidth } from "@dst0/p-tui";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
  getShellConfig,
  getShellEnv,
  killProcessTree,
  trackDetachedChildPid,
  untrackDetachedChildPid,
} from "../../utils/shell.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import {
  type BackgroundProcessManager,
  type BackgroundProcessSnapshot,
  defaultBackgroundProcessManager,
} from "./background-process.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "./truncate.ts";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
  yield_time_ms: Type.Optional(
    Type.Integer({
      description:
        "Milliseconds to stream before yielding a process session (default 10000, maximum 60000). Set 0 to run aside immediately.",
      minimum: 0,
      maximum: 60000,
    }),
  ),
});

export type BashToolInput = Static<typeof bashSchema>;

export type BashToolDetails = BackgroundProcessSnapshot;

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
  /**
   * Execute a command and stream output.
   * @param command The command to execute
   * @param cwd Working directory
   * @param options Execution options
   * @returns Promise resolving to exit code (null if killed)
   */
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

/**
 * Create bash operations using p's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want p's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const { shell, args } = getShellConfig(options?.shellPath);
      try {
        await fsAccess(cwd, constants.F_OK);
      } catch {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
      }
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const child = spawn(shell, [...args, `set -o pipefail; ${command}`], {
        cwd,
        detached: process.platform !== "win32",
        env: env ?? getShellEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      if (child.pid) trackDetachedChildPid(child.pid);
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const onAbort = () => {
        if (child.pid) killProcessTree(child.pid);
      };

      try {
        // Set timeout if provided.
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }
        // Stream stdout and stderr.
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        // Handle abort signal by killing the entire process tree.
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
        // Handle shell spawn errors and wait for the process to terminate without hanging
        // on inherited stdio handles held by detached descendants.
        const exitCode = await waitForChildProcess(child);
        if (signal?.aborted) {
          throw new Error("aborted");
        }
        if (timedOut) {
          throw new Error(`timeout:${timeout}`);
        }
        return { exitCode };
      } finally {
        if (child.pid) untrackDetachedChildPid(child.pid);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
  const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
  return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
  /** Custom operations for command execution. Default: local shell */
  operations?: BashOperations;
  /** Command prefix prepended to every command (for example shell setup commands) */
  commandPrefix?: string;
  /** Optional explicit shell path from settings */
  shellPath?: string;
  /** Hook to adjust command, cwd, or env before execution */
  spawnHook?: BashSpawnHook;
  /** Process lifecycle manager shared with the process wait/poll/kill tool */
  processManager?: BackgroundProcessManager;
  /** Callback invoked after command execution completes (for verification ledger recording) */
  onResult?: (context: {
    command: string;
    exitCode: number | null;
    truncated: boolean;
    fullOutputPath?: string;
  }) => void;
}

const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;

type BashRenderState = {
  startedAt: number | undefined;
  endedAt: number | undefined;
  interval: NodeJS.Timeout | undefined;
};

type BashResultRenderState = {
  cachedWidth: number | undefined;
  cachedLines: string[] | undefined;
  cachedSkipped: number | undefined;
};

class BashResultRenderComponent extends Container {
  state: BashResultRenderState = {
    cachedWidth: undefined,
    cachedLines: undefined,
    cachedSkipped: undefined,
  };
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBashCall(args: { command?: string; timeout?: number; yield_time_ms?: number } | undefined): string {
  const command = str(args?.command);
  const timeout = args?.timeout as number | undefined;
  const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
  const yieldSuffix = args?.yield_time_ms === undefined ? "" : theme.fg("muted", ` (yield ${args.yield_time_ms}ms)`);
  const commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
  return theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`)) + timeoutSuffix + yieldSuffix;
}

function rebuildBashResultRenderComponent(
  component: BashResultRenderComponent,
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: BashToolDetails;
  },
  options: ToolRenderResultOptions,
  showImages: boolean,
  startedAt: number | undefined,
  endedAt: number | undefined,
  showHarnessMessages?: boolean,
): void {
  const state = component.state;
  component.clear();

  let output = getTextOutput(result as any, showImages, options.showHarnessMessages ?? showHarnessMessages).trim();
  const truncation = result.details?.truncation;
  const fullOutputPath = result.details?.fullOutputPath;
  if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
    const footerStart = output.lastIndexOf("\n\n[");
    if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
      output = output.slice(0, footerStart).trimEnd();
    }
  }

  if (output) {
    const styledOutput = output
      .split("\n")
      .map((line) => theme.fg("toolOutput", line))
      .join("\n");

    if (options.expanded) {
      component.addChild(new Text(`\n${styledOutput}`, 0, 0));
    } else {
      component.addChild({
        render: (width: number) => {
          if (state.cachedLines === undefined || state.cachedWidth !== width) {
            const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
            state.cachedLines = preview.visualLines;
            state.cachedSkipped = preview.skippedCount;
            state.cachedWidth = width;
          }
          if (state.cachedSkipped && state.cachedSkipped > 0) {
            const hint =
              theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
              ` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
            return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
          }
          return ["", ...(state.cachedLines ?? [])];
        },
        invalidate: () => {
          state.cachedWidth = undefined;
          state.cachedLines = undefined;
          state.cachedSkipped = undefined;
        },
      });
    }
  }

  if (truncation?.truncated || fullOutputPath) {
    const warnings: string[] = [];
    if (fullOutputPath) {
      warnings.push(`Full output: ${fullOutputPath}`);
    }
    if (truncation?.truncated) {
      if (truncation.truncatedBy === "lines") {
        warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
      } else {
        warnings.push(
          `Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
        );
      }
    }
    component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
  }

  if (startedAt !== undefined) {
    const label = options.isPartial ? "Elapsed" : "Took";
    const endTime = endedAt ?? Date.now();
    component.addChild(new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0));
  }
}

export function createBashToolDefinition(
  cwd: string,
  options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
  const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
  const commandPrefix = options?.commandPrefix;
  const spawnHook = options?.spawnHook;
  const onResult = options?.onResult;
  const processManager = options?.processManager ?? defaultBackgroundProcessManager;
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. After yield_time_ms (default 10000), a still-running command yields a process session id so other work can continue. Use the process tool to wait for output/completion, inspect it, or interrupt it. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    parameters: bashSchema,
    async execute(
      _toolCallId,
      {
        command,
        timeout,
        yield_time_ms: yieldTimeMs = 10000,
      }: { command: string; timeout?: number; yield_time_ms?: number },
      signal?: AbortSignal,
      onUpdate?,
      _ctx?,
    ) {
      const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
      const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
      let updateTimer: NodeJS.Timeout | undefined;
      let pendingUpdate: BackgroundProcessSnapshot | undefined;
      let lastUpdateAt = 0;

      const emitOutputUpdate = () => {
        if (!onUpdate || !pendingUpdate) return;
        const snapshot = pendingUpdate;
        pendingUpdate = undefined;
        lastUpdateAt = Date.now();
        onUpdate({
          content: [{ type: "text", text: snapshot.output || "" }],
          details: snapshot,
        });
      };

      const clearUpdateTimer = () => {
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = undefined;
        }
      };

      const scheduleOutputUpdate = (snapshot: BackgroundProcessSnapshot) => {
        if (!onUpdate) return;
        pendingUpdate = snapshot;
        const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
        if (delay <= 0) {
          clearUpdateTimer();
          emitOutputUpdate();
          return;
        }
        updateTimer ??= setTimeout(() => {
          updateTimer = undefined;
          emitOutputUpdate();
        }, delay);
      };

      if (onUpdate) {
        onUpdate({ content: [], details: undefined });
      }

      const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;
      const formatOutput = (snapshot: BackgroundProcessSnapshot, emptyText = "(no output)") => {
        const truncation = snapshot.truncation;
        let text = snapshot.output || emptyText;
        if (truncation?.truncated) {
          const startLine = truncation.totalLines - truncation.outputLines + 1;
          const endLine = truncation.totalLines;
          if (truncation.truncatedBy === "lines") {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
          } else {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
          }
        }
        return text;
      };

      const sessionId = processManager.start({
        command: spawnContext.command,
        signal,
        execute: ({ onData, signal: processSignal }) =>
          ops.exec(spawnContext.command, spawnContext.cwd, {
            onData,
            signal: processSignal,
            timeout,
            env: spawnContext.env,
          }),
        onSettled: (snapshot) =>
          onResult?.({
            command: resolvedCommand,
            exitCode: snapshot.exitCode ?? null,
            truncated: snapshot.truncation?.truncated ?? false,
            fullOutputPath: snapshot.fullOutputPath,
          }),
      });

      try {
        let snapshot: BackgroundProcessSnapshot;
        try {
          snapshot = await processManager.waitForCompletion(sessionId, {
            signal,
            yieldTimeMs: Math.min(60000, Math.max(0, yieldTimeMs)),
            onUpdate: scheduleOutputUpdate,
          });
        } catch (error) {
          if (!signal?.aborted) {
            throw error;
          }
          snapshot = await processManager.waitForCompletion(sessionId);
        }

        clearUpdateTimer();
        pendingUpdate = snapshot;
        emitOutputUpdate();
        const outputText = formatOutput(snapshot, snapshot.status === "running" ? "(no output yet)" : "(no output)");

        if (snapshot.status === "running") {
          return {
            content: [
              {
                type: "text",
                text: appendStatus(
                  outputText,
                  `Command is still running (session ${snapshot.sessionId}). Use process action=wait to wake on output/completion, poll to inspect, or kill to interrupt.`,
                ),
              },
            ],
            details: snapshot,
            progress: "made_progress",
          };
        }
        if (snapshot.status === "cancelled") {
          throw new Error(appendStatus(outputText, "Command aborted"));
        }
        if (snapshot.status === "failed") {
          if (snapshot.error?.startsWith("timeout:")) {
            const timeoutSecs = snapshot.error.split(":")[1];
            throw new Error(appendStatus(outputText, `Command timed out after ${timeoutSecs} seconds`));
          }
          if (snapshot.error === "aborted") {
            throw new Error(appendStatus(outputText, "Command aborted"));
          }
          throw new Error(appendStatus(outputText, snapshot.error ?? "Command failed"));
        }
        return {
          content: [{ type: "text", text: outputText }],
          details: snapshot.truncation?.truncated ? snapshot : undefined,
          progress: "made_progress",
        };
      } finally {
        clearUpdateTimer();
      }
    },
    renderCall(args, _theme, context) {
      const state = context.state;
      if (context.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
        state.endedAt = undefined;
      }
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatBashCall(args));
      return text;
    },
    renderResult(result, options, _theme, context) {
      const state = context.state;
      if (state.startedAt !== undefined && options.isPartial && !state.interval) {
        state.interval = setInterval(() => context.invalidate(), 1000);
      }
      if (!options.isPartial || context.isError) {
        state.endedAt ??= Date.now();
        if (state.interval) {
          clearInterval(state.interval);
          state.interval = undefined;
        }
      }
      const component =
        (context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
      rebuildBashResultRenderComponent(
        component,
        result as any,
        options,
        context.showImages,
        state.startedAt,
        state.endedAt,
        context.showHarnessMessages,
      );
      component.invalidate();
      return component;
    },
  };
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
  return wrapToolDefinition(createBashToolDefinition(cwd, options));
}
