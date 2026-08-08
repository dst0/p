import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.ts";
import {
  flushRawStdout,
  takeOverStdout,
  waitForRawStdoutBackpressure,
  writeRawStdout,
} from "../../../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../../../utils/shell.ts";
import { attachJsonlLineReader, serializeJsonLine } from "../jsonl.ts";
import type { RpcCommand, RpcExtensionUIRequest, RpcExtensionUIResponse, RpcResponse } from "../rpc-types.ts";
import { createRpcErrorResponse, handleRpcCommand } from "./rpc-command-handler.ts";
import { RpcExtensionUIBridge } from "./rpc-extension-ui-bridge.ts";

export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
  takeOverStdout();
  let session = runtimeHost.session;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeBackpressure: (() => void) | undefined;

  const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
    writeRawStdout(serializeJsonLine(obj));
  };

  // Pending extension UI requests waiting for response
  const extensionUiBridge = new RpcExtensionUIBridge(output);

  // Shutdown request flag
  let shutdownRequested = false;
  let shuttingDown = false;
  const signalCleanupHandlers: Array<() => void> = [];

  /**
   * Create an extension UI context that uses the RPC protocol.
   */
  const createExtensionUIContext = () => extensionUiBridge.createContext();

  runtimeHost.setRebindSession(async () => {
    await rebindSession();
  });

  const rebindSession = async (): Promise<void> => {
    session = runtimeHost.session;
    await session.bindExtensions({
      uiContext: createExtensionUIContext(),
      mode: "rpc",
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async (options) => runtimeHost.newSession(options),
        fork: async (entryId, forkOptions) => {
          const result = await runtimeHost.fork(entryId, forkOptions);
          return { cancelled: result.cancelled };
        },
        navigateTree: async (targetId, options) => {
          const result = await session.navigateTree(targetId, {
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          });
          return { cancelled: result.cancelled };
        },
        switchSession: async (sessionPath, options) => {
          return runtimeHost.switchSession(sessionPath, options);
        },
        reload: async () => {
          await session.reload();
        },
      },
      shutdownHandler: () => {
        shutdownRequested = true;
      },
      onError: (err) => {
        output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
      },
    });

    unsubscribe?.();
    unsubscribeBackpressure?.();
    unsubscribe = session.subscribe((event) => {
      output(event);
    });
    unsubscribeBackpressure = session.agent.subscribe(async () => {
      await waitForRawStdoutBackpressure();
    });
  };

  const registerSignalHandlers = (): void => {
    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }

    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
      };
      process.on(signal, handler);
      signalCleanupHandlers.push(() => process.off(signal, handler));
    }
  };

  await rebindSession();
  registerSignalHandlers();

  /**
   * Check if shutdown was requested and perform shutdown if so.
   * Called after handling each command when waiting for the next command.
   */
  let detachInput = () => {};

  async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
    if (shuttingDown) {
      process.exit(exitCode);
    }
    shuttingDown = true;
    for (const cleanup of signalCleanupHandlers) {
      cleanup();
    }
    unsubscribe?.();
    unsubscribeBackpressure?.();
    await runtimeHost.dispose();
    detachInput();
    process.stdin.pause();
    if (signal !== "SIGTERM") {
      await flushRawStdout();
    }
    process.exit(exitCode);
  }

  async function checkShutdownRequested(): Promise<void> {
    if (!shutdownRequested) return;
    await shutdown();
  }

  const handleInputLine = async (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (parseError: unknown) {
      output(
        createRpcErrorResponse(
          undefined,
          "parse",
          `Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        ),
      );
      await waitForRawStdoutBackpressure();
      return;
    }

    // Handle extension UI responses
    if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "extension_ui_response") {
      const response = parsed as RpcExtensionUIResponse;
      extensionUiBridge.resolveResponse(response);
      return;
    }

    const command = parsed as RpcCommand;
    try {
      const response = await handleRpcCommand({ runtimeHost, rebindSession, output }, command);
      if (response) {
        output(response);
        await waitForRawStdoutBackpressure();
      }
      await checkShutdownRequested();
    } catch (commandError: unknown) {
      output(
        createRpcErrorResponse(
          command.id,
          command.type,
          commandError instanceof Error ? commandError.message : String(commandError),
        ),
      );
      await waitForRawStdoutBackpressure();
    }
  };

  const onInputEnd = () => {
    void shutdown();
  };
  process.stdin.on("end", onInputEnd);

  detachInput = (() => {
    const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
      void handleInputLine(line);
    });
    return () => {
      detachJsonl();
      process.stdin.off("end", onInputEnd);
    };
  })();

  // Keep process alive forever
  return new Promise(() => {});
}
