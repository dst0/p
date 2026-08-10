import type {
  ExtensionActions,
  ExtensionCommandContextActions,
  ExtensionContextActions,
  ExtensionFlag,
  ExtensionMode,
  ExtensionUIContext,
  ProviderConfig,
  RegisteredTool,
} from "../../types.ts";
import { noOpUIContext } from "../constants.ts";
import type { ExtensionRunner } from "../extensionrunner.ts";

export function do_bindCore(
  self: ExtensionRunner,
  actions: ExtensionActions,
  contextActions: ExtensionContextActions,
  providerActions?: {
    registerProvider?: (name: string, config: ProviderConfig) => void;
    unregisterProvider?: (name: string) => void;
  },
): void {
  // Copy actions into the shared runtime (all extension APIs reference self)
  self.runtime.sendMessage = actions.sendMessage;
  self.runtime.sendUserMessage = actions.sendUserMessage;
  self.runtime.appendEntry = actions.appendEntry;
  self.runtime.setSessionName = actions.setSessionName;
  self.runtime.getSessionName = actions.getSessionName;
  self.runtime.setLabel = actions.setLabel;
  self.runtime.getActiveTools = actions.getActiveTools;
  self.runtime.getAllTools = actions.getAllTools;
  self.runtime.setActiveTools = actions.setActiveTools;
  self.runtime.refreshTools = actions.refreshTools;
  self.runtime.getCommands = actions.getCommands;
  self.runtime.setModel = actions.setModel;
  self.runtime.getThinkingLevel = actions.getThinkingLevel;
  self.runtime.setThinkingLevel = actions.setThinkingLevel;

  // Context actions (required)
  self.getModel = contextActions.getModel;
  self.isIdleFn = contextActions.isIdle;
  self.isProjectTrustedFn = contextActions.isProjectTrusted;
  self.getSignalFn = contextActions.getSignal;
  self.abortFn = contextActions.abort;
  self.hasPendingMessagesFn = contextActions.hasPendingMessages;
  self.shutdownHandler = contextActions.shutdown;
  self.getContextUsageFn = contextActions.getContextUsage;
  self.compactFn = contextActions.compact;
  self.getSystemPromptFn = contextActions.getSystemPrompt;
  self.getSystemPromptOptionsFn = contextActions.getSystemPromptOptions ?? (() => ({ cwd: self.cwd }));

  // Flush provider registrations queued during extension loading
  for (const { name, config, extensionPath } of self.runtime.pendingProviderRegistrations) {
    try {
      if (providerActions?.registerProvider) {
        providerActions.registerProvider(name, config);
      } else {
        self.modelRegistry.registerProvider(name, config);
      }
    } catch (err) {
      self.emitError({
        extensionPath,
        event: "register_provider",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
  self.runtime.pendingProviderRegistrations = [];

  // From this point on, provider registration/unregistration takes effect immediately
  // without requiring a /reload.
  self.runtime.registerProvider = (name, config) => {
    if (providerActions?.registerProvider) {
      providerActions.registerProvider(name, config);
      return;
    }
    self.modelRegistry.registerProvider(name, config);
  };
  self.runtime.unregisterProvider = (name) => {
    if (providerActions?.unregisterProvider) {
      providerActions.unregisterProvider(name);
      return;
    }
    self.modelRegistry.unregisterProvider(name);
  };
}

export function do_bindCommandContext(self: ExtensionRunner, actions?: ExtensionCommandContextActions): void {
  if (actions) {
    self.waitForIdleFn = actions.waitForIdle;
    self.newSessionHandler = actions.newSession;
    self.forkHandler = actions.fork;
    self.navigateTreeHandler = actions.navigateTree;
    self.switchSessionHandler = actions.switchSession;
    self.reloadHandler = actions.reload;
    return;
  }

  self.waitForIdleFn = async () => {};
  self.newSessionHandler = async () => ({ cancelled: false });
  self.forkHandler = async () => ({ cancelled: false });
  self.navigateTreeHandler = async () => ({ cancelled: false });
  self.switchSessionHandler = async () => ({ cancelled: false });
  self.reloadHandler = async () => {};
}

export function do_setUIContext(
  self: ExtensionRunner,
  uiContext?: ExtensionUIContext,
  mode: ExtensionMode = "print",
): void {
  self.uiContext = uiContext ?? noOpUIContext;
  self.mode = mode;
}

export function do_getUIContext(self: ExtensionRunner): ExtensionUIContext {
  return self.uiContext;
}

export function do_hasUI(self: ExtensionRunner): boolean {
  return self.uiContext !== noOpUIContext;
}

export function do_getExtensionPaths(self: ExtensionRunner): string[] {
  return self.extensions.map((e) => e.path);
}

export function do_getAllRegisteredTools(self: ExtensionRunner): RegisteredTool[] {
  const toolsByName = new Map<string, RegisteredTool>();
  for (const ext of self.extensions) {
    for (const tool of ext.tools.values()) {
      if (!toolsByName.has(tool.definition.name)) {
        toolsByName.set(tool.definition.name, tool);
      }
    }
  }
  return Array.from(toolsByName.values());
}

export function do_getToolDefinition(
  self: ExtensionRunner,
  toolName: string,
): RegisteredTool["definition"] | undefined {
  for (const ext of self.extensions) {
    const tool = ext.tools.get(toolName);
    if (tool) {
      return tool.definition;
    }
  }
  return undefined;
}

export function do_getFlags(self: ExtensionRunner): Map<string, ExtensionFlag> {
  const allFlags = new Map<string, ExtensionFlag>();
  for (const ext of self.extensions) {
    for (const [name, flag] of ext.flags) {
      if (!allFlags.has(name)) {
        allFlags.set(name, flag);
      }
    }
  }
  return allFlags;
}

export function do_setFlagValue(self: ExtensionRunner, name: string, value: boolean | string): void {
  self.runtime.flagValues.set(name, value);
}

export function do_getFlagValues(self: ExtensionRunner): Map<string, boolean | string> {
  return new Map(self.runtime.flagValues);
}
