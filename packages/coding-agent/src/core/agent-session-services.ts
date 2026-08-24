import { join } from "node:path";
import type { CompletionMode, CompletionProtocolLimits, ThinkingLevel } from "@dst0/p-agent-core";
import type { Model } from "@dst0/p-ai";
import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AuthStorage } from "./auth-storage.ts";
import type { SessionStartEvent, ToolDefinition } from "./extensions/index.ts";
import { ModelRegistry } from "./model-registry.ts";
import {
  DefaultResourceLoader,
  type DefaultResourceLoaderOptions,
  type ResourceLoader,
  type ResourceLoaderReloadOptions,
} from "./resource-loader.ts";
import { type CreateAgentSessionOptions, type CreateAgentSessionResult, createAgentSession } from "./sdk.ts";
import type { SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";
import {
  createTaskVerificationController,
  REQUIREMENT_AUDIT_TOOL_NAME,
  TASK_VERIFICATION_TOOL_NAME,
} from "./task-verification.ts";

/**
 * Non-fatal issues collected while creating services or sessions.
 *
 * Runtime creation returns diagnostics to the caller instead of printing or
 * exiting. The app layer decides whether warnings should be shown and whether
 * errors should abort startup.
 */
export interface AgentSessionRuntimeDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
}

/**
 * Inputs for creating cwd-bound runtime services.
 *
 * These services are recreated whenever the effective session cwd changes.
 * CLI-provided resource paths should be resolved to absolute paths before they
 * reach this function, so later cwd switches do not reinterpret them.
 */
export interface CreateAgentSessionServicesOptions {
  cwd: string;
  agentDir?: string;
  authStorage?: AuthStorage;
  settingsManager?: SettingsManager;
  modelRegistry?: ModelRegistry;
  extensionFlagValues?: Map<string, boolean | string>;
  resourceLoaderOptions?: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">;
  resourceLoaderReloadOptions?: ResourceLoaderReloadOptions;
}

/**
 * Inputs for creating an AgentSession from already-created services.
 *
 * Use this after services exist and any cwd-bound model/tool/session options
 * have been resolved against those services.
 */
export interface CreateAgentSessionFromServicesOptions {
  services: AgentSessionServices;
  sessionManager: SessionManager;
  sessionStartEvent?: SessionStartEvent;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  tools?: string[];
  userInputTools?: CreateAgentSessionOptions["userInputTools"];
  excludeTools?: CreateAgentSessionOptions["excludeTools"];
  noTools?: CreateAgentSessionOptions["noTools"];
  customTools?: ToolDefinition[];
  completionMode?: CompletionMode;
  completionLimits?: CompletionProtocolLimits;
  maxTokens?: CreateAgentSessionOptions["maxTokens"];
  projectInstructionMode?: CreateAgentSessionOptions["projectInstructionMode"];
  projectInstructionCompilerModel?: CreateAgentSessionOptions["projectInstructionCompilerModel"];
}

/**
 * Coherent cwd-bound runtime services for one effective session cwd.
 *
 * This is infrastructure only. The AgentSession itself is created separately so
 * session options can be resolved against these services first.
 */
export interface AgentSessionServices {
  cwd: string;
  agentDir: string;
  authStorage: AuthStorage;
  settingsManager: SettingsManager;
  modelRegistry: ModelRegistry;
  resourceLoader: ResourceLoader;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

const MUTATING_BUILTIN_TOOLS = new Set(["bash", "edit", "write"]);

function shouldEnableTaskVerification(options: CreateAgentSessionFromServicesOptions): boolean {
  if (
    options.excludeTools?.includes(TASK_VERIFICATION_TOOL_NAME) ||
    options.excludeTools?.includes(REQUIREMENT_AUDIT_TOOL_NAME)
  ) {
    return false;
  }
  const activeTools = options.tools ?? (options.noTools ? [] : [...MUTATING_BUILTIN_TOOLS]);
  const excluded = new Set(options.excludeTools ?? []);
  return activeTools.some((name) => MUTATING_BUILTIN_TOOLS.has(name) && !excluded.has(name));
}

function addToolName(toolNames: string[] | undefined, toolName: string): string[] | undefined {
  if (!toolNames) return undefined;
  return toolNames.includes(toolName) ? toolNames : [...toolNames, toolName];
}

function addToolDefinitions(
  tools: ToolDefinition[] | undefined,
  verificationTools: ToolDefinition[],
): ToolDefinition[] {
  const reservedNames = new Set([TASK_VERIFICATION_TOOL_NAME, REQUIREMENT_AUDIT_TOOL_NAME]);
  const collision = tools?.find((tool) => reservedNames.has(tool.name));
  if (collision) {
    throw new Error(`${collision.name} is reserved by the built-in verification controller`);
  }
  return [...verificationTools, ...(tools ?? [])];
}

function applyExtensionFlagValues(
  resourceLoader: ResourceLoader,
  extensionFlagValues: Map<string, boolean | string> | undefined,
): AgentSessionRuntimeDiagnostic[] {
  if (!extensionFlagValues) {
    return [];
  }

  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const extensionsResult = resourceLoader.getExtensions();
  const registeredFlags = new Map<string, { type: "boolean" | "string" }>();
  for (const extension of extensionsResult.extensions) {
    for (const [name, flag] of extension.flags) {
      registeredFlags.set(name, { type: flag.type });
    }
  }

  const unknownFlags: string[] = [];
  for (const [name, value] of extensionFlagValues) {
    const flag = registeredFlags.get(name);
    if (!flag) {
      unknownFlags.push(name);
      continue;
    }
    if (flag.type === "boolean") {
      extensionsResult.runtime.flagValues.set(name, true);
      continue;
    }
    if (typeof value === "string") {
      extensionsResult.runtime.flagValues.set(name, value);
      continue;
    }
    diagnostics.push({
      type: "error",
      message: `Extension flag "--${name}" requires a value`,
    });
  }

  if (unknownFlags.length > 0) {
    diagnostics.push({
      type: "error",
      message: `Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
    });
  }

  return diagnostics;
}

/**
 * Create cwd-bound runtime services.
 *
 * Returns services plus diagnostics. It does not create an AgentSession.
 */
export async function createAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
  const cwd = resolvePath(options.cwd);
  const agentDir = options.agentDir ? resolvePath(options.agentDir) : getAgentDir();
  const authStorage = options.authStorage ?? AuthStorage.create(join(agentDir, "auth.json"));
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const resourceLoader = new DefaultResourceLoader({
    ...(options.resourceLoaderOptions ?? {}),
    cwd,
    agentDir,
    settingsManager,
  });
  await resourceLoader.reload(options.resourceLoaderReloadOptions);

  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const extensionsResult = resourceLoader.getExtensions();
  for (const { name, config, extensionPath } of extensionsResult.runtime.pendingProviderRegistrations) {
    try {
      modelRegistry.registerProvider(name, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        type: "error",
        message: `Extension "${extensionPath}" error: ${message}`,
      });
    }
  }
  extensionsResult.runtime.pendingProviderRegistrations = [];
  diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));

  return {
    cwd,
    agentDir,
    authStorage,
    settingsManager,
    modelRegistry,
    resourceLoader,
    diagnostics,
  };
}

/**
 * Create an AgentSession from previously created services.
 *
 * This keeps session creation separate from service creation so callers can
 * resolve model, thinking, tools, and other session inputs against the target
 * cwd before constructing the session.
 */
export async function createAgentSessionFromServices(
  options: CreateAgentSessionFromServicesOptions,
): Promise<CreateAgentSessionResult> {
  const verificationEnabled = shouldEnableTaskVerification(options);
  const verificationController = verificationEnabled
    ? createTaskVerificationController(options.sessionManager)
    : undefined;
  const result = await createAgentSession({
    cwd: options.services.cwd,
    agentDir: options.services.agentDir,
    authStorage: options.services.authStorage,
    settingsManager: options.services.settingsManager,
    modelRegistry: options.services.modelRegistry,
    resourceLoader: options.services.resourceLoader,
    sessionManager: options.sessionManager,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    scopedModels: options.scopedModels,
    tools: verificationEnabled
      ? addToolName(addToolName(options.tools, TASK_VERIFICATION_TOOL_NAME), REQUIREMENT_AUDIT_TOOL_NAME)
      : options.tools,
    userInputTools: options.userInputTools,
    excludeTools: options.excludeTools,
    noTools: options.noTools,
    customTools: verificationController
      ? addToolDefinitions(options.customTools, [
          verificationController.toolDefinition,
          verificationController.requirementAuditToolDefinition,
        ])
      : options.customTools,
    sessionStartEvent: options.sessionStartEvent,
    completionMode: options.completionMode,
    completionLimits: options.completionLimits,
    maxTokens: options.maxTokens,
    projectInstructionMode: options.projectInstructionMode,
    projectInstructionCompilerModel: options.projectInstructionCompilerModel,
  });
  if (verificationController) {
    result.session._projectRuleSafeToolDefinitions.add(verificationController.toolDefinition);
    result.session.setActiveToolsByName([
      ...result.session.getActiveToolNames(),
      TASK_VERIFICATION_TOOL_NAME,
      REQUIREMENT_AUDIT_TOOL_NAME,
    ]);
    verificationController.install(result.session.agent);
  }
  return result;
}
