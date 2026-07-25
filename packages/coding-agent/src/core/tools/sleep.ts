import type { AgentTool } from "@dst0/p-agent-core";
import { Text } from "@dst0/p-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const sleepSchema = Type.Object({
  seconds: Type.Number({ description: "Seconds to wait before running the required check" }),
  check: Type.Object(
    {
      tool: Type.String({
        description: "Tool that will inspect concrete external state after the wait. Cannot be sleep or finish_work.",
      }),
      arguments: Type.Record(Type.String(), Type.Unknown(), {
        description: "Arguments for the check tool",
      }),
    },
    {
      description:
        "Required continuation. The runtime executes this tool immediately after sleeping, in the same sequential batch.",
    },
  ),
});

export type SleepToolInput = Static<typeof sleepSchema>;

export interface SleepToolDetails {
  seconds: number;
  check: SleepToolInput["check"];
}

function formatSleepCall(args: { seconds?: number; check?: { tool?: string } } | undefined, theme: Theme): string {
  const seconds = Number.isFinite(args?.seconds) ? Math.max(0, args?.seconds ?? 0) : 0;
  const check = args?.check?.tool ? ` → ${args.check.tool}` : " → invalid: missing check";
  return `${theme.fg("toolTitle", theme.bold("sleep"))} ${theme.fg("toolOutput", `${seconds}s${check}`)}`;
}

export function createSleepToolDefinition(): ToolDefinition<typeof sleepSchema, SleepToolDetails> {
  return {
    name: "sleep",
    label: "sleep",
    description:
      "Wait briefly and then run a required concrete check. Supply check.tool and check.arguments; the runtime executes that check immediately after the delay. Bare sleeps and sleep-to-sleep continuations are invalid. For a running bash session, use process action=wait instead because it observes the process directly.",
    promptSnippet: "Wait briefly, then immediately run a required concrete check",
    parameters: sleepSchema,
    executionMode: "sequential",
    async execute(_toolCallId, { seconds, check }: SleepToolInput, signal?: AbortSignal) {
      const safeSeconds = Number.isFinite(seconds) ? Math.min(60, Math.max(0, seconds)) : 0;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }
        const timeout = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, safeSeconds * 1000);
        const onAbort = () => {
          clearTimeout(timeout);
          reject(new Error("Operation aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return {
        content: [
          {
            type: "text",
            text: `Slept for ${safeSeconds} seconds. Running required check \`${check.tool}\` now.`,
          },
        ],
        details: { seconds: safeSeconds, check },
        progress: "waiting",
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatSleepCall(args, theme));
      return text;
    },
  };
}

export function createSleepTool(): AgentTool<typeof sleepSchema> {
  return wrapToolDefinition(createSleepToolDefinition());
}
