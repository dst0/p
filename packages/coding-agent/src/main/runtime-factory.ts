import type { parseArgs } from "../cli/args.ts";
import { createProjectTrustContext } from "../cli/project-trust.ts";
import type { CreateAgentSessionRuntimeFactory } from "../core/agent-session-runtime.ts";
import {
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "../core/agent-session-services.ts";
import type { AuthStorage } from "../core/auth-storage.ts";
import { resolveModelScope } from "../core/model-resolver.ts";
import { type AppMode, resolveProjectTrusted } from "../core/project-trust.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, type ProjectTrustStore } from "../core/trust-manager.ts";
import { collectSettingsDiagnostics } from "./cli-entry.ts";
import { buildSessionOptions } from "./runtime-init.ts";
import type { MainOptions } from "./types.ts";

interface CliRuntimeFactoryOptions {
  agentDir: string;
  appMode: AppMode;
  authStorage: AuthStorage;
  extensionFactories: MainOptions["extensionFactories"];
  parsed: ReturnType<typeof parseArgs>;
  resolvedExtensionPaths: string[] | undefined;
  resolvedPromptTemplatePaths: string[] | undefined;
  resolvedSkillPaths: string[] | undefined;
  resolvedThemePaths: string[] | undefined;
  startupSettingsManager: SettingsManager;
  trustPromptMode: AppMode;
  trustStore: ProjectTrustStore;
}

interface CliRuntimeServicesInput {
  cwd: string;
  agentDir: string;
  isInitialRuntime: boolean;
  projectTrustContext?: Parameters<CreateAgentSessionRuntimeFactory>[0]["projectTrustContext"];
}

interface CliRuntimeServicesResult {
  services: AgentSessionServices;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

function createCliRuntimeServicesFactory(
  options: CliRuntimeFactoryOptions,
): (input: CliRuntimeServicesInput) => Promise<CliRuntimeServicesResult> {
  const projectTrustByCwd = new Map<string, boolean>();

  return async ({ cwd, agentDir, isInitialRuntime, projectTrustContext }) => {
    const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
    const cachedProjectTrust = projectTrustByCwd.get(cwd);
    const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
    const shouldResolveProjectTrust =
      options.parsed.projectTrustOverride === undefined &&
      cachedProjectTrust === undefined &&
      hasTrustRequiringResources;
    const projectTrusted = shouldResolveProjectTrust
      ? false
      : (cachedProjectTrust ??
        options.parsed.projectTrustOverride ??
        (!hasTrustRequiringResources || options.trustStore.get(cwd) === true));
    const runtimeSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      authStorage: options.authStorage,
      settingsManager: runtimeSettingsManager,
      extensionFlagValues: options.parsed.unknownFlags,
      resourceLoaderReloadOptions: shouldResolveProjectTrust
        ? {
            resolveProjectTrust: async ({ extensionsResult }) => {
              const trusted = await resolveProjectTrusted({
                cwd,
                trustStore: options.trustStore,
                trustOverride: options.parsed.projectTrustOverride,
                defaultProjectTrust: options.startupSettingsManager.getDefaultProjectTrust(),
                extensionsResult,
                projectTrustContext:
                  projectTrustContext ??
                  createProjectTrustContext({
                    cwd,
                    mode: isInitialRuntime ? options.trustPromptMode : options.appMode,
                    settingsManager: options.startupSettingsManager,
                    hasUI: isInitialRuntime && options.trustPromptMode === "interactive",
                  }),
                onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
              });
              projectTrustByCwd.set(cwd, trusted);
              return trusted;
            },
          }
        : undefined,
      resourceLoaderOptions: {
        additionalExtensionPaths: options.resolvedExtensionPaths,
        additionalSkillPaths: options.resolvedSkillPaths,
        additionalPromptTemplatePaths: options.resolvedPromptTemplatePaths,
        additionalThemePaths: options.resolvedThemePaths,
        noExtensions: options.parsed.noExtensions,
        noSkills: options.parsed.noSkills,
        noPromptTemplates: options.parsed.noPromptTemplates,
        noThemes: options.parsed.noThemes,
        noContextFiles: options.parsed.noContextFiles,
        systemPrompt: options.parsed.systemPrompt,
        appendSystemPrompt: options.parsed.appendSystemPrompt,
        extensionFactories: options.extensionFactories,
      },
    });
    const { settingsManager, resourceLoader } = services;
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...projectTrustDiagnostics,
      ...services.diagnostics,
      ...collectSettingsDiagnostics(settingsManager, "runtime creation"),
      ...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
        type: "error" as const,
        message: `Failed to load extension "${path}": ${error}`,
      })),
    ];

    return { services, diagnostics };
  };
}

export async function createCliMetadataServices(
  options: CliRuntimeFactoryOptions,
  input: Omit<CliRuntimeServicesInput, "isInitialRuntime">,
): Promise<CliRuntimeServicesResult> {
  return createCliRuntimeServicesFactory(options)({ ...input, isInitialRuntime: true });
}

export function createCliRuntimeFactory(options: CliRuntimeFactoryOptions): CreateAgentSessionRuntimeFactory {
  const createRuntimeServices = createCliRuntimeServicesFactory(options);

  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }) => {
    const { services, diagnostics } = await createRuntimeServices({
      cwd,
      agentDir,
      isInitialRuntime: sessionStartEvent === undefined,
      projectTrustContext,
    });
    const { settingsManager, modelRegistry } = services;

    const modelPatterns = options.parsed.models ?? settingsManager.getEnabledModels();
    const scopedModels =
      modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
    const {
      options: sessionOptions,
      cliThinkingFromModel,
      diagnostics: sessionOptionDiagnostics,
    } = buildSessionOptions(
      options.parsed,
      options.appMode,
      scopedModels,
      sessionManager.buildSessionContext().messages.length > 0,
      modelRegistry,
      settingsManager,
    );
    diagnostics.push(...sessionOptionDiagnostics);

    if (options.parsed.apiKey) {
      if (!sessionOptions.model) {
        diagnostics.push({
          type: "error",
          message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
        });
      } else {
        options.authStorage.setRuntimeApiKey(sessionOptions.model.provider, options.parsed.apiKey);
      }
    }

    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model: sessionOptions.model,
      thinkingLevel: sessionOptions.thinkingLevel,
      scopedModels: sessionOptions.scopedModels,
      tools: sessionOptions.tools,
      userInputTools: sessionOptions.userInputTools,
      excludeTools: sessionOptions.excludeTools,
      noTools: sessionOptions.noTools,
      customTools: sessionOptions.customTools,
      completionMode: sessionOptions.completionMode,
      completionLimits: sessionOptions.completionLimits,
      maxTokens: sessionOptions.maxTokens,
      taskVerificationMode: sessionOptions.taskVerificationMode,
      projectInstructionMode: sessionOptions.projectInstructionMode,
      projectInstructionCompilerModel: sessionOptions.projectInstructionCompilerModel,
    });
    const cliThinkingOverride = options.parsed.thinking !== undefined || cliThinkingFromModel;
    if (created.session.model && cliThinkingOverride) {
      created.session.setThinkingLevel(created.session.thinkingLevel);
    }

    return { ...created, services, diagnostics };
  };
}
