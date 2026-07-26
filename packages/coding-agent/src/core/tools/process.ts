import type { AgentTool } from "@dst0/p-agent-core";
import { Text } from "@dst0/p-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import {
  type BackgroundProcessManager,
  type BackgroundProcessSnapshot,
  defaultBackgroundProcessManager,
} from "./background-process.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const processSchema = Type.Object({
  action: Type.Union([Type.Literal("wait"), Type.Literal("poll"), Type.Literal("kill")], {
    description:
      "wait streams output while waiting for completion or yield_time_ms, poll returns immediately, and kill interrupts the process tree",
  }),
  session_id: Type.String({ description: "Process session id returned by bash" }),
  yield_time_ms: Type.Optional(
    Type.Integer({
      description:
        "Milliseconds to stream before yielding control back to the agent (default 10000, maximum 60000). Streams output updates while waiting.",
      minimum: 0,
      maximum: 60000,
    }),
  ),
});

export type ProcessToolInput = Static<typeof processSchema>;
export type ProcessToolDetails = BackgroundProcessSnapshot;

export interface ProcessToolOptions {
  manager?: BackgroundProcessManager;
}

function formatProcessCall(args: Partial<ProcessToolInput> | undefined, theme: Theme): string {
  const action = args?.action ?? "wait";
  const sessionId = args?.session_id ?? "...";
  const yieldSuffix = args?.yield_time_ms === undefined ? "" : theme.fg("muted", ` (yield ${args.yield_time_ms}ms)`);
  return `${theme.fg("toolTitle", theme.bold(`process ${action}`))} ${theme.fg("toolOutput", sessionId)}${yieldSuffix}`;
}

function formatProcessResult(snapshot: BackgroundProcessSnapshot): string {
  const output = snapshot.output.trimEnd();
  const status =
    snapshot.status === "running"
      ? `Process is still running (session ${snapshot.sessionId}).`
      : snapshot.status === "completed"
        ? `Process completed with exit code ${snapshot.exitCode ?? 0}.`
        : snapshot.status === "cancelled"
          ? `Process was interrupted (session ${snapshot.sessionId}).`
          : `Process failed${snapshot.exitCode === undefined ? "" : ` with exit code ${snapshot.exitCode}`}.`;
  return output ? `${output}\n\n${status}` : status;
}

function createProcessResult(snapshot: BackgroundProcessSnapshot) {
  return {
    content: [{ type: "text" as const, text: formatProcessResult(snapshot) }],
    details: snapshot,
    progress: snapshot.status === "running" && !snapshot.newOutput ? ("waiting" as const) : ("made_progress" as const),
  };
}

export function createProcessToolDefinition(
  options?: ProcessToolOptions,
): ToolDefinition<typeof processSchema, ProcessToolDetails> {
  const manager = options?.manager ?? defaultBackgroundProcessManager;
  return {
    name: "process",
    label: "process",
    description:
      "Inspect, wait for, or interrupt an asynchronous bash process. action=wait streams output while waiting for completion or yield_time_ms (default 10000ms). Use poll to inspect immediately or kill to stop a stuck process.",
    promptSnippet: "Wait for, inspect, or interrupt asynchronous bash processes",
    parameters: processSchema,
    executionMode: "sequential",
    async execute(_toolCallId, input, signal, onUpdate) {
      let snapshot: BackgroundProcessSnapshot;
      try {
        if (input.action === "kill") {
          snapshot = await manager.kill(input.session_id);
        } else if (input.action === "poll") {
          snapshot = manager.observe(input.session_id);
        } else {
          snapshot = await manager.waitForCompletion(input.session_id, {
            signal,
            yieldTimeMs: input.yield_time_ms ?? 10000,
            onUpdate: (update) => onUpdate?.(createProcessResult(update)),
          });
        }
      } catch (error) {
        if (signal?.aborted && input.action === "wait") {
          await manager.kill(input.session_id);
        }
        throw error;
      }

      if (snapshot.status === "failed") {
        throw new Error(`${formatProcessResult(snapshot)}${snapshot.error ? `\n${snapshot.error}` : ""}`);
      }
      if (snapshot.status === "cancelled" && input.action !== "kill") {
        throw new Error(formatProcessResult(snapshot));
      }
      return createProcessResult(snapshot);
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatProcessCall(args, theme));
      return text;
    },
  };
}

export function createProcessTool(options?: ProcessToolOptions): AgentTool<typeof processSchema, ProcessToolDetails> {
  return wrapToolDefinition(createProcessToolDefinition(options));
}
