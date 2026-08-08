import type { AssistantMessage } from "@dst0/p-ai";
import { isContextOverflow, resetApiProviders } from "@dst0/p-ai";
import { ExtensionRunner, type ToolDefinition } from "../../extensions/index.ts";
import { emitSessionShutdownEvent } from "../../extensions/runner.ts";
import {
  createAllToolDefinitions,
  createFinishWorkToolDefinition,
  createSubmitPlanToolDefinition,
} from "../../tools/index.ts";
import { createToolDefinitionFromAgentTool } from "../../tools/tool-definition-wrapper.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  MARK_SESSION_PROGRESS_TOOL_NAME,
  RETRYABLE_ERROR_PATTERN,
  TOOL_SEARCH_TOOL_NAME,
  UPDATE_SESSION_STATE_TOOL_NAME,
} from "../constants.ts";

export function do__buildRuntime(
  self: AgentSession,
  options: {
    activeToolNames?: string[];
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  },
): void {
  const autoResizeImages = self.settingsManager.getImageAutoResize();
  const shellCommandPrefix = self.settingsManager.getShellCommandPrefix();
  const shellPath = self.settingsManager.getShellPath();
  const baseToolDefinitions = self._baseToolsOverride
    ? Object.fromEntries(
        Object.entries(self._baseToolsOverride).map(([name, tool]) => [name, createToolDefinitionFromAgentTool(tool)]),
      )
    : createAllToolDefinitions(self._cwd, {
        read: { autoResizeImages },
        bash: {
          commandPrefix: shellCommandPrefix,
          shellPath,
          onResult: (context) =>
            self._verificationLedger.record(context.command, {
              exitCode: context.exitCode ?? undefined,
              truncated: context.truncated,
              fullLogPointer: context.fullOutputPath,
            }),
        },
      });
  const builtInToolDefinitions: Record<string, ToolDefinition> = {
    ...baseToolDefinitions,
    [UPDATE_SESSION_STATE_TOOL_NAME]: self._createUpdateSessionStateToolDefinition() as unknown as ToolDefinition,
    [MARK_SESSION_PROGRESS_TOOL_NAME]: self._createMarkSessionProgressToolDefinition() as unknown as ToolDefinition,
    submit_plan: createSubmitPlanToolDefinition({
      onApproved: () => self.disablePlanMode(),
    }) as unknown as ToolDefinition,
    session_recall: self._createSessionRecallToolDefinition() as unknown as ToolDefinition,
    keep_context: self._createKeepContextToolDefinition() as unknown as ToolDefinition,
    run_subagent: self._createRunSubagentToolDefinition() as unknown as ToolDefinition,
    [TOOL_SEARCH_TOOL_NAME]: self._createToolSearchToolDefinition() as unknown as ToolDefinition,
    finish_work: createFinishWorkToolDefinition({
      gateCheck: {
        check: (input) => {
          if (input.status !== "success") return null;
          const gate = self._verificationLedger.gate();
          if (!gate) return null;
          const failureLines = gate.failures.map((f) => `  - ${f.command} (exit ${f.exitCode})`);
          return [
            `Required verification checks failed. Cannot finish with success.`,
            `Failures:`,
            ...failureLines,
            `Run the failing commands or use status "partial" / "failed" to proceed.`,
          ].join("\n");
        },
      },
    }) as unknown as ToolDefinition,
  };

  self._baseToolDefinitions = new Map(
    Object.entries(builtInToolDefinitions).map(([name, tool]) => [name, tool as ToolDefinition]),
  );

  const extensionsResult = self._resourceLoader.getExtensions();
  if (options.flagValues) {
    for (const [name, value] of options.flagValues) {
      extensionsResult.runtime.flagValues.set(name, value);
    }
  }

  self._extensionRunner = new ExtensionRunner(
    extensionsResult.extensions,
    extensionsResult.runtime,
    self._cwd,
    self.sessionManager,
    self._modelRegistry,
  );
  if (self._extensionRunnerRef) {
    self._extensionRunnerRef.current = self._extensionRunner;
  }
  self._bindExtensionCore(self._extensionRunner);
  self._applyExtensionBindings(self._extensionRunner);

  const defaultActiveToolNames = self._baseToolsOverride
    ? Object.keys(self._baseToolsOverride)
    : [
        "read",
        "bash",
        "edit",
        "write",
        "sleep",
        UPDATE_SESSION_STATE_TOOL_NAME,
        MARK_SESSION_PROGRESS_TOOL_NAME,
        TOOL_SEARCH_TOOL_NAME,
      ];
  const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
  self._refreshToolRegistry({
    activeToolNames: baseActiveToolNames,
    includeAllExtensionTools: options.includeAllExtensionTools,
  });
}

export async function do_reload(self: AgentSession): Promise<void> {
  const previousFlagValues = self._extensionRunner.getFlagValues();
  await emitSessionShutdownEvent(self._extensionRunner, {
    type: "session_shutdown",
    reason: "reload",
  });
  await self.settingsManager.reload();
  self.syncQueueModesFromSettings();
  resetApiProviders();
  await self._resourceLoader.reload();
  self._buildRuntime({
    activeToolNames: self.getActiveToolNames(),
    flagValues: previousFlagValues,
    includeAllExtensionTools: self._includeAllExtensionTools,
  });

  const hasBindings =
    self._extensionUIContext ||
    self._extensionCommandContextActions ||
    self._extensionShutdownHandler ||
    self._extensionErrorListener;
  if (hasBindings) {
    await self._extensionRunner.emit({
      type: "session_start",
      reason: "reload",
    });
    await self.extendResourcesFromExtensions("reload");
  }
}

export function do__isNonRetryableProviderLimitError(_self: AgentSession, errorMessage: string): boolean {
  return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(
    errorMessage,
  );
}

export function do__isRetryableError(self: AgentSession, message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;

  // Context overflow is handled by compaction, not retry
  const contextWindow = self.model?.contextWindow ?? 0;
  if (isContextOverflow(message, contextWindow)) return false;

  const err = message.errorMessage;
  if (self._isNonRetryableProviderLimitError(err)) return false;
  return RETRYABLE_ERROR_PATTERN.test(err);
}
