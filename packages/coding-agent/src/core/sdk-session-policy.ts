import type { CompletionMode } from "@dst0/p-agent-core";
import type { LoadExtensionsResult, ToolDefinition } from "./extensions/index.ts";
import type { ProjectInstructionDeliveryMode } from "./project-instructions/types.ts";
import { collectInitialActiveToolEffects, createSdkToolEffectInventory } from "./sdk-tool-effect-inventory.ts";
import { resolveSdkToolPolicy } from "./sdk-tool-policy.ts";
import type { SessionManager } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { TaskVerificationMode } from "./task-verification/mode.ts";
import {
  assertReservedTaskVerificationToolNames,
  type PreparedTaskVerificationRuntime,
  prepareTaskVerificationRuntime,
} from "./task-verification-session-runtime.ts";

interface SdkSessionPolicyOptions {
  taskVerificationMode?: TaskVerificationMode;
  completionMode?: CompletionMode;
  tools?: string[];
  excludeTools?: string[];
  noTools?: "all" | "builtin";
  customTools?: ToolDefinition[];
  userInputTools?: boolean;
  includeAllExtensionTools?: boolean;
}

interface PrepareSdkSessionPolicyInputs {
  options: SdkSessionPolicyOptions;
  projectInstructionMode: ProjectInstructionDeliveryMode;
  extensionsResult: LoadExtensionsResult;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
}

export interface PreparedSdkSessionPolicy {
  taskVerification: PreparedTaskVerificationRuntime;
  allowedToolNames: string[] | undefined;
  excludedToolNames: string[] | undefined;
  initialActiveToolNames: string[];
  explicitlyToolless: boolean;
}

export function prepareSdkSessionPolicy(inputs: PrepareSdkSessionPolicyInputs): PreparedSdkSessionPolicy {
  const { options, extensionsResult } = inputs;
  assertReservedTaskVerificationToolNames([
    ...(options.customTools ?? []),
    ...extensionsResult.extensions.flatMap((extension) =>
      Array.from(extension.tools.values(), ({ definition }) => definition),
    ),
  ]);
  const toolEffects = createSdkToolEffectInventory(options.customTools, extensionsResult);
  const sdkToolPolicy = resolveSdkToolPolicy({
    projectInstructionMode: inputs.projectInstructionMode,
    tools: options.tools,
    noTools: options.noTools,
    excludeTools: options.excludeTools,
    userInputTools: options.userInputTools,
    toolEffects,
  });
  const activeToolEffects = collectInitialActiveToolEffects({
    inventory: toolEffects,
    initialActiveToolNames: sdkToolPolicy.initialActiveToolNames,
    allowedToolNames: sdkToolPolicy.allowedToolNames,
    excludeTools: options.excludeTools,
    customTools: options.customTools,
    extensionsResult,
    includeAllExtensionTools: options.includeAllExtensionTools ?? options.noTools === "builtin",
  });
  const taskVerification = prepareTaskVerificationRuntime(
    { ...options, tools: sdkToolPolicy.allowedToolNames, activeToolEffects },
    inputs.sessionManager,
    inputs.settingsManager,
  );
  return {
    taskVerification,
    allowedToolNames: taskVerification.tools ?? sdkToolPolicy.allowedToolNames,
    excludedToolNames: sdkToolPolicy.excludedToolNames,
    initialActiveToolNames: sdkToolPolicy.initialActiveToolNames,
    explicitlyToolless: sdkToolPolicy.explicitlyToolless,
  };
}
