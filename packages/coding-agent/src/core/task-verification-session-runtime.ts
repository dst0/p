import { type CompletionMode, type ResolvedToolEffect, resolveToolEffect } from "@dst0/p-agent-core";
import type { InstalledTaskVerificationRuntime } from "./agent-session/task-verification-runtime-state.ts";
import type { AgentSession } from "./agent-session.ts";
import type { ToolDefinition } from "./extensions/index.ts";
import type { SessionManager } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { TaskVerificationMode } from "./task-verification/mode.ts";
import { LIGHT_DEFERRED_TOOL_NAMES } from "./task-verification/task-tier.ts";
import {
  resolveTaskVerificationConfiguration,
  type TaskVerificationConfiguration,
  type TaskVerificationSelection,
  taskVerificationEngineMode,
} from "./task-verification/verification-policy.ts";
import {
  finalizeTaskVerificationCompletion,
  taskVerificationFinalizerBatchError,
} from "./task-verification/verified-completion-runtime.ts";
import type { TaskVerificationController } from "./task-verification.ts";
import {
  createTaskVerificationController,
  REQUIREMENT_AUDIT_TOOL_NAME,
  TASK_VERIFICATION_TOOL_NAME,
} from "./task-verification.ts";
import { beginCodeTask } from "./task-verification-begin-code-task.ts";
import { resolveTaskVerificationSessionPolicy } from "./task-verification-session-policy.ts";
import { TASK_VERIFICATION_TIER_CUSTOM_TYPE, TaskVerificationTierRuntime } from "./task-verification-tier-runtime.ts";
import { installVerificationTier, observeVerificationTierEffect } from "./task-verification-tier-session.ts";
import { BEGIN_CODE_TASK_TOOL_NAME, createBeginCodeTaskToolDefinition } from "./tools/begin-code-task.ts";

interface TaskVerificationRuntimeOptions {
  taskVerificationMode?: TaskVerificationSelection;
  completionMode?: CompletionMode;
  tools?: string[];
  excludeTools?: string[];
  noTools?: "all" | "builtin";
  customTools?: ToolDefinition[];
  activeToolEffects: readonly ResolvedToolEffect[];
}

interface PreparedTaskVerificationRuntimeBase {
  completionMode: CompletionMode;
  /** Engine mode enforced by the initial tier; `off` while LIGHT. */
  effectiveMode: TaskVerificationMode;
  configuration: TaskVerificationConfiguration;
  tools?: string[];
  customTools?: ToolDefinition[];
  requiredToolNames: string[];
  toolDefinitions: ToolDefinition[];
}

export type PreparedTaskVerificationRuntime = PreparedTaskVerificationRuntimeBase &
  (
    | { controller: TaskVerificationController; tier: TaskVerificationTierRuntime }
    | { controller?: undefined; tier?: undefined }
  );

function addToolNames(toolNames: string[] | undefined, requiredToolNames: string[]): string[] | undefined {
  if (!toolNames) return undefined;
  return [...new Set([...toolNames, ...requiredToolNames])];
}

function addToolDefinitions(
  tools: ToolDefinition[] | undefined,
  verificationTools: ToolDefinition[],
): ToolDefinition[] {
  return [...verificationTools, ...(tools ?? [])];
}

export function assertReservedTaskVerificationToolNames(tools: Iterable<Pick<ToolDefinition, "name">>): void {
  const reservedNames = new Set([TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME, BEGIN_CODE_TASK_TOOL_NAME]);
  for (const tool of tools) {
    if (reservedNames.has(tool.name)) {
      throw new Error(`${tool.name} is reserved by the built-in verification controller`);
    }
  }
}

function createVerificationToolDefinitions(
  controller: TaskVerificationController,
  mode: TaskVerificationMode,
  tier: TaskVerificationTierRuntime,
): ToolDefinition[] {
  const controlPlaneEffect = { kind: "read" as const, risk: "normal" as const };
  return [
    { ...controller.toolDefinition, effect: controlPlaneEffect, promptSnippet: undefined },
    ...(mode === "audit"
      ? [{ ...controller.requirementAuditToolDefinition, effect: controlPlaneEffect, promptSnippet: undefined }]
      : []),
    createBeginCodeTaskToolDefinition((input) => beginCodeTask(tier, controller, input)) as unknown as ToolDefinition,
  ];
}

function createTierRuntime(
  configuration: TaskVerificationConfiguration,
  sessionManager: SessionManager,
): TaskVerificationTierRuntime {
  const tier = new TaskVerificationTierRuntime({
    configuredPolicy: configuration.policy,
    persist: (entry) => sessionManager.appendCustomEntry(TASK_VERIFICATION_TIER_CUSTOM_TYPE, entry),
  });
  tier.restore(sessionManager.getBranch());
  return tier;
}

export function prepareTaskVerificationRuntime(
  options: TaskVerificationRuntimeOptions,
  sessionManager: SessionManager,
  settingsManager: SettingsManager,
): PreparedTaskVerificationRuntime {
  assertReservedTaskVerificationToolNames(options.customTools ?? []);
  const configuration = resolveTaskVerificationConfiguration(
    options.taskVerificationMode,
    settingsManager.getTaskVerificationConfiguration(),
  );
  const configuredMode = taskVerificationEngineMode(configuration);
  const policy = resolveTaskVerificationSessionPolicy({
    mode: configuredMode,
    activeToolEffects: options.activeToolEffects,
    excludeTools: options.excludeTools,
    allowReadOnlyEvidence: options.tools === undefined && options.noTools !== "all",
  });
  const completionMode = options.completionMode ?? settingsManager.getCompletionMode();
  if (configuredMode !== "off" && configuration.policy !== "light" && completionMode !== "explicit_finish") {
    throw new Error(`Task verification policy "${configuration.policy}" requires explicit_finish completion mode`);
  }
  if (configuredMode === "off") {
    return {
      completionMode,
      effectiveMode: "off",
      configuration,
      tools: addToolNames(options.tools, []),
      customTools: options.customTools,
      requiredToolNames: policy.requiredToolNames,
      toolDefinitions: [],
    };
  }
  const controller = createTaskVerificationController(sessionManager, configuredMode);
  const tier = createTierRuntime(configuration, sessionManager);
  const toolDefinitions = createVerificationToolDefinitions(controller, configuredMode, tier);
  return {
    completionMode,
    effectiveMode: policy.enabled && tier.tier === "strict" ? configuredMode : "off",
    configuration,
    tools: addToolNames(
      options.tools,
      toolDefinitions.map((definition) => definition.name),
    ),
    customTools: addToolDefinitions(options.customTools, toolDefinitions),
    controller,
    tier,
    requiredToolNames: policy.requiredToolNames,
    toolDefinitions,
  };
}

function controllerLifecycleIsPending(runtime: InstalledTaskVerificationRuntime): boolean {
  return runtime.controller.currentState.mutationRevision > 0;
}

export function reconcileTaskVerificationRuntime(session: AgentSession, requestedToolNames: string[]): string[] {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return requestedToolNames;
  const nonVerificationToolNames = requestedToolNames.filter((name) => !runtime.managedToolNames.has(name));
  const activeToolEffects = nonVerificationToolNames
    .map((name) => session._toolRegistry.get(name))
    .filter((tool) => tool !== undefined)
    .map((tool) => resolveToolEffect(tool.effect));
  const policy = resolveTaskVerificationSessionPolicy({
    mode: runtime.configuredMode,
    activeToolEffects,
    excludeTools: session._excludedToolNames ? [...session._excludedToolNames] : undefined,
    retainVerification: controllerLifecycleIsPending(runtime),
    allowReadOnlyEvidence: session._allowedToolNames === undefined,
  });
  const tier = runtime.tier;
  runtime.enabled = policy.enabled && tier.policy !== "off";
  const enforcing = runtime.enabled && tier.tier === "strict";
  runtime.controller.observeOnly = !enforcing;
  runtime.controller.relaxedZeroEffectCompletion = tier.policy === "auto";
  session._taskVerificationMode = enforcing ? runtime.configuredMode : "off";
  if (enforcing) return [...new Set([...nonVerificationToolNames, ...policy.requiredToolNames])];
  const offerEscalation =
    runtime.enabled && tier.escalationEnabled && session._toolRegistry.has(BEGIN_CODE_TASK_TOOL_NAME);
  return offerEscalation ? [...nonVerificationToolNames, BEGIN_CODE_TASK_TOOL_NAME] : nonVerificationToolNames;
}

function installControllerHookGate(session: AgentSession, runtime: InstalledTaskVerificationRuntime): void {
  const nativeBeforeToolCall = session.agent.beforeToolCall;
  const nativeAfterToolCall = session.agent.afterToolCall;
  runtime.controller.install(session.agent);
  const controlledBeforeToolCall = session.agent.beforeToolCall;
  const controlledAfterToolCall = session.agent.afterToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    if (!runtime.enabled) return await nativeBeforeToolCall?.(context, signal);
    const finalizerBatchError = taskVerificationFinalizerBatchError(runtime, context);
    if (finalizerBatchError) return { block: true, reason: finalizerBatchError };
    return await controlledBeforeToolCall?.(context, signal);
  };
  session.agent.afterToolCall = async (context, signal) => {
    if (!runtime.enabled) return await nativeAfterToolCall?.(context, signal);
    const result = await controlledAfterToolCall?.(context, signal);
    const verifiedCompletion = finalizeTaskVerificationCompletion(session, runtime, context, result);
    observeVerificationTierEffect(runtime);
    if (verifiedCompletion) {
      session.setActiveToolsByName(session.getActiveToolNames());
      return verifiedCompletion;
    }
    if (
      context.toolCall.name === "finish_work" &&
      !(
        (result?.isError ?? context.isError) ||
        !(typeof context.args === "object" && context.args !== null && "status" in context.args) ||
        context.args.status !== "success"
      )
    ) {
      session.setActiveToolsByName(session.getActiveToolNames());
    }
    return result;
  };
}

export function installTaskVerificationRuntime(session: AgentSession, runtime: PreparedTaskVerificationRuntime): void {
  if (!runtime.controller) return;
  for (const definition of runtime.toolDefinitions) {
    session._projectRuleSafeToolDefinitions.add(definition);
  }
  const activeToolNames = session.getActiveToolNames();
  const installedRuntime: InstalledTaskVerificationRuntime = {
    configuredMode: runtime.controller.mode as Exclude<TaskVerificationMode, "off">,
    controller: runtime.controller,
    enabled: runtime.effectiveMode !== "off",
    managedToolNames: new Set(runtime.toolDefinitions.map((definition) => definition.name)),
    tier: runtime.tier,
    tierManagedToolNames:
      session._allowedToolNames === undefined
        ? LIGHT_DEFERRED_TOOL_NAMES.filter((name) => activeToolNames.includes(name))
        : [],
    observedLedger: new Set(),
  };
  session._taskVerificationRuntime = installedRuntime;
  installControllerHookGate(session, installedRuntime);
  installVerificationTier(session, installedRuntime);
}
