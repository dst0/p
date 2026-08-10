import type { AgentEvent } from "@dst0/p-agent-core";
import { installDelegatedMethods } from "../../utils/install-delegated-methods.ts";
import type { CustomMessage } from "../messages.ts";
import { installAgentSessionPrepareNextTurn } from "../prepare-next-turn.ts";
import * as agentEventHandling from "./agentsession-methods/agent-event-handling.ts";
import * as authDelegates from "./agentsession-methods/auth.ts";
import * as autoCompactionDelegates from "./agentsession-methods/auto-compaction.ts";
import * as branchSummaryDelegates from "./agentsession-methods/branch-summary.ts";
import * as compactDelegates from "./agentsession-methods/compact.ts";
import * as compactionDryRunDelegates from "./agentsession-methods/compaction-dry-run.ts";
import * as compactionPreparationDelegates from "./agentsession-methods/compaction-preparation.ts";
import * as eventEmissionDelegates from "./agentsession-methods/event-emission.ts";
import * as extensionCoreDelegates from "./agentsession-methods/extension-core.ts";
import * as extensionsDelegates from "./agentsession-methods/extensions.ts";
import * as fastResponderDelegates from "./agentsession-methods/fast-responder.ts";
import * as finishWorkAuditDelegates from "./agentsession-methods/finish-work-audit.ts";
import * as keepContextToolsDelegates from "./agentsession-methods/keep-context-tools.ts";
import * as modelResolutionDelegates from "./agentsession-methods/model-resolution.ts";
import * as projectMemoryDelegates from "./agentsession-methods/project-memory.ts";
import * as promptContextDelegates from "./agentsession-methods/prompt-context.ts";
import * as queueControlDelegates from "./agentsession-methods/queue-control.ts";
import * as recallDelegates from "./agentsession-methods/recall.ts";
import * as retryDelegates from "./agentsession-methods/retry.ts";
import * as runtimeBuildDelegates from "./agentsession-methods/runtime-build.ts";
import * as sessionExportDelegates from "./agentsession-methods/session-export.ts";
import * as sessionForkingDelegates from "./agentsession-methods/session-forking.ts";
import * as sessionToolsDelegates from "./agentsession-methods/session-tools.ts";
import * as shellDelegates from "./agentsession-methods/shell.ts";
import * as statePatchDelegates from "./agentsession-methods/state-patch.ts";
import * as subagentDelegates from "./agentsession-methods/subagent.ts";
import * as thinkingLevelDelegates from "./agentsession-methods/thinking-level.ts";
import * as thinkingLevelSwitchDelegates from "./agentsession-methods/thinking-level-switch.ts";
import * as toolActivationDelegates from "./agentsession-methods/tool-activation.ts";
import * as toolHooksDelegates from "./agentsession-methods/tool-hooks.ts";
import * as toolRegistryDelegates from "./agentsession-methods/tool-registry.ts";
import * as treeNavigationDelegates from "./agentsession-methods/tree-navigation.ts";
import * as updateSessionStateDelegates from "./agentsession-methods/update-session-state.ts";
import * as userMessagingDelegates from "./agentsession-methods/user-messaging.ts";
import type { AgentSessionMethods } from "./agentsession-methods.ts";
import { AgentSessionState } from "./agentsessionstate.ts";
import type { AgentSessionConfig } from "./session-types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
export class AgentSession extends AgentSessionState {
  constructor(config: AgentSessionConfig) {
    super(config);
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
    this._installAgentToolHooks();
    this._installPromptContextTransform();
    this._buildRuntime({
      activeToolNames: this._initialActiveToolNames,
      includeAllExtensionTools: this._includeAllExtensionTools,
    });
    installAgentSessionPrepareNextTurn(this.agent, this, this.settingsManager);
  }

  public _handleAgentEvent = (event: AgentEvent): Promise<void> => agentEventHandling.handleAgentEvent(this, event);

  async sendCustomMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: {
      triggerTurn?: boolean;
      deliverAs?: "steer" | "followUp" | "nextTurn";
    },
  ): Promise<void> {
    return thinkingLevelDelegates.do_sendCustomMessage(this, message, options);
  }
}

export interface AgentSession extends AgentSessionMethods {}

installDelegatedMethods(AgentSession.prototype, [
  authDelegates,
  autoCompactionDelegates,
  branchSummaryDelegates,
  compactDelegates,
  compactionDryRunDelegates,
  compactionPreparationDelegates,
  eventEmissionDelegates,
  extensionCoreDelegates,
  extensionsDelegates,
  fastResponderDelegates,
  finishWorkAuditDelegates,
  keepContextToolsDelegates,
  modelResolutionDelegates,
  projectMemoryDelegates,
  promptContextDelegates,
  queueControlDelegates,
  recallDelegates,
  retryDelegates,
  runtimeBuildDelegates,
  sessionExportDelegates,
  sessionForkingDelegates,
  sessionToolsDelegates,
  shellDelegates,
  statePatchDelegates,
  subagentDelegates,
  thinkingLevelDelegates,
  thinkingLevelSwitchDelegates,
  toolActivationDelegates,
  toolHooksDelegates,
  toolRegistryDelegates,
  treeNavigationDelegates,
  updateSessionStateDelegates,
  userMessagingDelegates,
]);
