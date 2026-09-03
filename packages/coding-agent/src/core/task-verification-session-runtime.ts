import { type CompletionMode, type ResolvedToolEffect, resolveToolEffect } from "@dst0/p-agent-core";
import type { InstalledTaskVerificationRuntime } from "./agent-session/task-verification-runtime-state.ts";
import type { AgentSession } from "./agent-session.ts";
import type { ToolDefinition } from "./extensions/index.ts";
import type { SessionManager } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { TaskVerificationMode } from "./task-verification/mode.ts";
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
import { resolveTaskVerificationSessionPolicy } from "./task-verification-session-policy.ts";

interface TaskVerificationRuntimeOptions {
  taskVerificationMode?: TaskVerificationMode;
  completionMode?: CompletionMode;
  tools?: string[];
  excludeTools?: string[];
  noTools?: "all" | "builtin";
  customTools?: ToolDefinition[];
  activeToolEffects: readonly ResolvedToolEffect[];
}

export interface PreparedTaskVerificationRuntime {
  completionMode: CompletionMode;
  effectiveMode: TaskVerificationMode;
  tools?: string[];
  customTools?: ToolDefinition[];
  controller?: TaskVerificationController;
  requiredToolNames: string[];
  toolDefinitions: ToolDefinition[];
}

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
  const reservedNames = new Set([TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME]);
  for (const tool of tools) {
    if (reservedNames.has(tool.name)) {
      throw new Error(`${tool.name} is reserved by the built-in verification controller`);
    }
  }
}

function createVerificationToolDefinitions(
  controller: TaskVerificationController,
  mode: TaskVerificationMode,
): ToolDefinition[] {
  const controlPlaneEffect = { kind: "read" as const, risk: "normal" as const };
  return [
    { ...controller.toolDefinition, effect: controlPlaneEffect, promptSnippet: undefined },
    ...(mode === "audit"
      ? [{ ...controller.requirementAuditToolDefinition, effect: controlPlaneEffect, promptSnippet: undefined }]
      : []),
  ];
}

export function prepareTaskVerificationRuntime(
  options: TaskVerificationRuntimeOptions,
  sessionManager: SessionManager,
  settingsManager: SettingsManager,
): PreparedTaskVerificationRuntime {
  assertReservedTaskVerificationToolNames(options.customTools ?? []);
  const configuredMode = options.taskVerificationMode ?? settingsManager.getTaskVerificationMode();
  const policy = resolveTaskVerificationSessionPolicy({
    mode: configuredMode,
    activeToolEffects: options.activeToolEffects,
    excludeTools: options.excludeTools,
    allowReadOnlyEvidence: options.tools === undefined && options.noTools !== "all",
  });
  const completionMode = options.completionMode ?? settingsManager.getCompletionMode();
  if (configuredMode !== "off" && completionMode !== "explicit_finish") {
    throw new Error(`Task verification mode "${configuredMode}" requires explicit_finish completion mode`);
  }
  const effectiveMode = policy.enabled ? configuredMode : "off";
  const controller =
    configuredMode === "off" ? undefined : createTaskVerificationController(sessionManager, configuredMode);
  const toolDefinitions = controller ? createVerificationToolDefinitions(controller, configuredMode) : [];
  return {
    completionMode,
    effectiveMode,
    tools: addToolNames(
      options.tools,
      toolDefinitions.map((definition) => definition.name),
    ),
    customTools: controller ? addToolDefinitions(options.customTools, toolDefinitions) : options.customTools,
    controller,
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
  runtime.enabled = policy.enabled;
  session._taskVerificationMode = policy.enabled ? runtime.configuredMode : "off";
  return policy.enabled
    ? [...new Set([...nonVerificationToolNames, ...policy.requiredToolNames])]
    : nonVerificationToolNames;
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
    const result = runtime.enabled
      ? await controlledAfterToolCall?.(context, signal)
      : await nativeAfterToolCall?.(context, signal);
    const verifiedCompletion = runtime.enabled
      ? finalizeTaskVerificationCompletion(session, runtime, context, result)
      : undefined;
    if (verifiedCompletion) {
      session.setActiveToolsByName(session.getActiveToolNames());
      return verifiedCompletion;
    }
    if (
      runtime.enabled &&
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
  const installedRuntime: InstalledTaskVerificationRuntime = {
    configuredMode: runtime.controller.mode as Exclude<TaskVerificationMode, "off">,
    controller: runtime.controller,
    enabled: runtime.effectiveMode !== "off",
    managedToolNames: new Set(runtime.toolDefinitions.map((definition) => definition.name)),
  };
  session._taskVerificationRuntime = installedRuntime;
  installControllerHookGate(session, installedRuntime);
  session.setActiveToolsByName(session.getActiveToolNames());
}
