import { modelsAreEqual } from "@dst0/p-ai";
import type { Args } from "../cli/args.ts";
import { showStartupSelector } from "../cli/startup-ui.ts";
import type { AgentSessionRuntimeDiagnostic } from "../core/agent-session-services.ts";
import type { ModelRegistry } from "../core/model-registry.ts";
import { resolveCliModel, type ScopedModel } from "../core/model-resolver.ts";
import type { AppMode } from "../core/project-trust.ts";
import type { CreateAgentSessionOptions } from "../core/sdk.ts";
import { formatMissingSessionCwdPrompt, type SessionCwdIssue } from "../core/session-cwd.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { isLocalPath, resolvePath } from "../utils/paths.ts";

export function buildSessionOptions(
  parsed: Args,
  appMode: AppMode,
  scopedModels: ScopedModel[],
  hasExistingSession: boolean,
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager,
): {
  options: CreateAgentSessionOptions;
  cliThinkingFromModel: boolean;
  diagnostics: AgentSessionRuntimeDiagnostic[];
} {
  const options: CreateAgentSessionOptions = {};
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  let cliThinkingFromModel = false;

  // Model from CLI
  // - supports --provider <name> --model <pattern>
  // - supports --model <provider>/<pattern>
  if (parsed.model) {
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      cliThinking: parsed.thinking,
      modelRegistry,
    });
    if (resolved.warning) {
      diagnostics.push({ type: "warning", message: resolved.warning });
    }
    if (resolved.error) {
      diagnostics.push({ type: "error", message: resolved.error });
    }
    if (resolved.model) {
      options.model = resolved.model;
      // Allow "--model <pattern>:<thinking>" as a shorthand.
      // Explicit --thinking still takes precedence (applied later).
      if (!parsed.thinking && resolved.thinkingLevel) {
        options.thinkingLevel = resolved.thinkingLevel;
        cliThinkingFromModel = true;
      }
    }
  }

  if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
    // Check if saved default is in scoped models - use it if so, otherwise first scoped model
    const savedProvider = settingsManager.getDefaultProvider();
    const savedModelId = settingsManager.getDefaultModel();
    const savedModel = savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined;
    const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;

    if (savedInScope) {
      options.model = savedInScope.model;
      // Use thinking level from scoped model config if explicitly set
      if (!parsed.thinking && savedInScope.thinkingLevel) {
        options.thinkingLevel = savedInScope.thinkingLevel;
      }
    } else {
      options.model = scopedModels[0].model;
      // Use thinking level from first scoped model if explicitly set
      if (!parsed.thinking && scopedModels[0].thinkingLevel) {
        options.thinkingLevel = scopedModels[0].thinkingLevel;
      }
    }
  }

  // Thinking level from CLI (takes precedence over scoped model thinking levels set above)
  if (parsed.thinking) {
    options.thinkingLevel = parsed.thinking;
  }

  // Scoped models for Ctrl+P cycling
  // Keep thinking level undefined when not explicitly set in the model pattern.
  // Undefined means "inherit current session thinking level" during cycling.
  if (scopedModels.length > 0) {
    options.scopedModels = scopedModels.map((sm) => ({
      model: sm.model,
      thinkingLevel: sm.thinkingLevel,
    }));
  }

  // API key from CLI - set in authStorage
  // (handled by caller before createAgentSession)

  // Tools
  if (parsed.noTools) {
    options.noTools = "all";
  } else if (parsed.noBuiltinTools) {
    options.noTools = "builtin";
  }
  if (parsed.tools) {
    options.tools = [...parsed.tools];
  }
  if (appMode === "interactive" && !parsed.tools && !parsed.noTools && !parsed.noBuiltinTools) {
    options.userInputTools = true;
  }
  if (parsed.excludeTools) {
    options.excludeTools = [...parsed.excludeTools];
  }
  if (parsed.completionMode) {
    options.completionMode = parsed.completionMode;
  }
  if (parsed.taskVerificationMode) {
    options.taskVerificationMode = parsed.taskVerificationMode;
  }
  if (parsed.maxTokens !== undefined) {
    options.maxTokens = parsed.maxTokens;
  }
  options.projectInstructionMode = parsed.noContextFiles ? "off" : parsed.projectInstructionMode;
  options.projectInstructionCompilerModel = parsed.projectInstructionCompilerModel;

  return { options, cliThinkingFromModel, diagnostics };
}

export function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
  return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

export async function promptForMissingSessionCwd(
  issue: SessionCwdIssue,
  settingsManager: SettingsManager,
): Promise<string | undefined> {
  return showStartupSelector(settingsManager, formatMissingSessionCwdPrompt(issue), [
    { label: "Continue", value: issue.fallbackCwd },
    { label: "Cancel", value: undefined },
  ]);
}
