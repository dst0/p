import { basename, dirname } from "node:path";
import type { ExtensionRunner } from "../../extensions/index.ts";
import type { ResourceExtensionPaths } from "../../resource-loader.ts";
import type { AgentSession } from "../agentsession.ts";
import type { ExtensionBindings } from "../session-types.ts";

export function do_setAutoCompactionEnabled(self: AgentSession, enabled: boolean): void {
  self.settingsManager.setCompactionEnabled(enabled);
}

export function do__getEffectiveCompactionSettings(self: AgentSession): {
  enabled: boolean;
  triggerReserveTokens: number;
  triggerRatio?: number;
  keepRecentMinTokens: number;
  keepRecentMaxTokens: number;
  summaryMaxTokens: number;
  renderedStateMaxTokens: number;
  targetContextTokens: number;
} {
  return self.settingsManager.getCompactionSettings();
}

export async function do_bindExtensions(self: AgentSession, bindings: ExtensionBindings): Promise<void> {
  if (bindings.uiContext !== undefined) {
    self._extensionUIContext = bindings.uiContext;
  }
  if (bindings.mode !== undefined) {
    self._extensionMode = bindings.mode;
  }
  if (bindings.commandContextActions !== undefined) {
    self._extensionCommandContextActions = bindings.commandContextActions;
  }
  if (bindings.abortHandler !== undefined) {
    self._extensionAbortHandler = bindings.abortHandler;
  }
  if (bindings.shutdownHandler !== undefined) {
    self._extensionShutdownHandler = bindings.shutdownHandler;
  }
  if (bindings.onError !== undefined) {
    self._extensionErrorListener = bindings.onError;
  }

  self._applyExtensionBindings(self._extensionRunner);
  await self._extensionRunner.emit(self._sessionStartEvent);
  await self.extendResourcesFromExtensions(self._sessionStartEvent.reason === "reload" ? "reload" : "startup");
}

export async function do_extendResourcesFromExtensions(
  self: AgentSession,
  reason: "startup" | "reload",
): Promise<void> {
  if (!self._extensionRunner.hasHandlers("resources_discover")) {
    return;
  }

  const { skillPaths, promptPaths, themePaths } = await self._extensionRunner.emitResourcesDiscover(self._cwd, reason);

  if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
    return;
  }

  const extensionPaths: ResourceExtensionPaths = {
    skillPaths: self.buildExtensionResourcePaths(skillPaths),
    promptPaths: self.buildExtensionResourcePaths(promptPaths),
    themePaths: self.buildExtensionResourcePaths(themePaths),
  };

  self._resourceLoader.extendResources(extensionPaths);
  if (self._projectInstructionMode === "compiled") await self._projectInstructions.refresh();
  self._baseSystemPrompt = self._rebuildSystemPrompt(self.getActiveToolNames());
  self.agent.state.systemPrompt = self._baseSystemPrompt;
}

export function do_buildExtensionResourcePaths(
  self: AgentSession,
  entries: Array<{ path: string; extensionPath: string }>,
): Array<{
  path: string;
  metadata: {
    source: string;
    scope: "temporary";
    origin: "top-level";
    baseDir?: string;
  };
}> {
  return entries.map((entry) => {
    const source = self.getExtensionSourceLabel(entry.extensionPath);
    const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
    return {
      path: entry.path,
      metadata: {
        source,
        scope: "temporary",
        origin: "top-level",
        baseDir,
      },
    };
  });
}

export function do_getExtensionSourceLabel(_self: AgentSession, extensionPath: string): string {
  if (extensionPath.startsWith("<")) {
    return `extension:${extensionPath.replace(/[<>]/g, "")}`;
  }
  const base = basename(extensionPath);
  const name = base.replace(/\.(ts|js)$/, "");
  return `extension:${name}`;
}

export function do__applyExtensionBindings(self: AgentSession, runner: ExtensionRunner): void {
  runner.setUIContext(self._extensionUIContext, self._extensionMode);
  runner.bindCommandContext(self._extensionCommandContextActions);

  self._extensionErrorUnsubscriber?.();
  self._extensionErrorUnsubscriber = self._extensionErrorListener
    ? runner.onError(self._extensionErrorListener)
    : undefined;
}

export function do__refreshCurrentModelFromRegistry(self: AgentSession): void {
  const currentModel = self.model;
  if (!currentModel) {
    return;
  }

  const refreshedModel = self._modelRegistry.find(currentModel.provider, currentModel.id);
  if (!refreshedModel || refreshedModel === currentModel) {
    return;
  }

  self.agent.state.model = refreshedModel;
}
