/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `p -p "prompt"` - text output
 * - `p --mode json "prompt"` - JSON event stream
 */

import { type AgentMessage, getFinishWorkPayload } from "@dst0/p-agent-core";
import type { ImageContent } from "@dst0/p-ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, writeRawStdout } from "../core/output-guard.ts";
import { getTaskVerificationCompletionPayload } from "../core/task-verification/verified-completion.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";
import { projectJsonEvent } from "./json-event-projection.ts";
import {
  assistantMessagesText,
  getFinalResponseAssistantMessages,
  getRepairedFinalResponse,
} from "./print-mode-final-response.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
  /** Output mode: "text" for final response only, "json" for all events */
  mode: "text" | "json";
  /** Array of additional prompts to send after initialMessage */
  messages?: string[];
  /** First message to send (may contain @file content) */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
}

export interface TextModeFinalOutput {
  text?: string;
  error?: string;
  exitCode: number;
}

export function getTextModeFinalOutput(messages: readonly AgentMessage[]): TextModeFinalOutput {
  const finishPayload = getFinishWorkPayload(messages);
  if (finishPayload) {
    return {
      text:
        finishPayload.status === "success"
          ? (getRepairedFinalResponse(messages) ?? finishPayload.summary)
          : finishPayload.summary,
      exitCode: finishPayload.status === "failed" ? 1 : 0,
    };
  }
  const verifiedCompletion = getTaskVerificationCompletionPayload(messages);
  if (verifiedCompletion) {
    return { text: verifiedCompletion.summary, exitCode: 0 };
  }

  const assistantMessages = getFinalResponseAssistantMessages(messages);
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
  if (!lastAssistantMessage) {
    return { exitCode: 0 };
  }

  const isTerminalError = lastAssistantMessage.stopReason === "error" || lastAssistantMessage.stopReason === "aborted";
  const error = isTerminalError
    ? lastAssistantMessage.errorMessage || `Request ${lastAssistantMessage.stopReason}`
    : undefined;
  const text = assistantMessages
    .map((message, index) => {
      const messageText = assistantMessagesText([message]);
      const isTerminalDiagnostic = index === assistantMessages.length - 1 && error === messageText;
      return isTerminalDiagnostic ? "" : messageText;
    })
    .join("");

  if (error) {
    return {
      ...(text ? { text } : {}),
      error,
      exitCode: 1,
    };
  }

  return {
    text,
    exitCode: 0,
  };
}

function getSessionStateTextModeFinalOutput(messages: readonly AgentMessage[]): TextModeFinalOutput {
  if (getFinishWorkPayload(messages)) {
    return getTextModeFinalOutput(messages);
  }
  const lastMessage = messages[messages.length - 1];
  return getTextModeFinalOutput(lastMessage ? [lastMessage] : []);
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
  const { mode, messages = [], initialMessage, initialImages } = options;
  let exitCode = 0;
  let session = runtimeHost.session;
  let unsubscribe: (() => void) | undefined;
  let latestAgentEndMessages: readonly AgentMessage[] | undefined;
  let disposed = false;
  const signalCleanupHandlers: Array<() => void> = [];

  const disposeRuntime = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    await runtimeHost.dispose();
  };

  const registerSignalHandlers = (): void => {
    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }

    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void disposeRuntime().finally(() => {
          process.exit(signal === "SIGHUP" ? 129 : 143);
        });
      };
      process.on(signal, handler);
      signalCleanupHandlers.push(() => process.off(signal, handler));
    }
  };

  registerSignalHandlers();

  runtimeHost.setRebindSession(async () => {
    await rebindSession();
  });

  const rebindSession = async (): Promise<void> => {
    session = runtimeHost.session;
    await session.bindExtensions({
      mode: mode === "json" ? "json" : "print",
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
        fork: async (entryId, forkOptions) => {
          const result = await runtimeHost.fork(entryId, forkOptions);
          return { cancelled: result.cancelled };
        },
        navigateTree: async (targetId, navigateOptions) => {
          const result = await session.navigateTree(targetId, {
            summarize: navigateOptions?.summarize,
            customInstructions: navigateOptions?.customInstructions,
            replaceInstructions: navigateOptions?.replaceInstructions,
            label: navigateOptions?.label,
          });
          return { cancelled: result.cancelled };
        },
        switchSession: async (sessionPath, switchOptions) => {
          return runtimeHost.switchSession(sessionPath, switchOptions);
        },
        reload: async () => {
          await session.reload();
        },
      },
      onError: (err) => {
        console.error(`Extension error (${err.extensionPath}): ${err.error}`);
      },
    });

    unsubscribe?.();
    unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_end" && !event.willRetry) {
        latestAgentEndMessages = event.messages;
      }
      if (mode === "json") {
        writeRawStdout(`${JSON.stringify(projectJsonEvent(event))}\n`);
      }
    });
  };

  try {
    if (mode === "json") {
      const header = session.sessionManager.getHeader();
      if (header) {
        writeRawStdout(`${JSON.stringify(header)}\n`);
      }
    }

    await rebindSession();

    if (initialMessage) {
      latestAgentEndMessages = undefined;
      await session.prompt(initialMessage, { images: initialImages });
    }

    for (const message of messages) {
      latestAgentEndMessages = undefined;
      await session.prompt(message);
    }

    if (mode === "text") {
      const finalOutput = latestAgentEndMessages
        ? getTextModeFinalOutput(latestAgentEndMessages)
        : getSessionStateTextModeFinalOutput(session.state.messages);
      exitCode = finalOutput.exitCode;
      if (finalOutput.text) {
        writeRawStdout(`${finalOutput.text}\n`);
      }
      if (finalOutput.error) {
        console.error(finalOutput.error);
      }
    }

    return exitCode;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    for (const cleanup of signalCleanupHandlers) {
      cleanup();
    }
    await disposeRuntime();
    await flushRawStdout();
  }
}
