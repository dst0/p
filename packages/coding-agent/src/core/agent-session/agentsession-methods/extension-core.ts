import type { ExtensionRunner } from "../../extensions/index.ts";
import type { SlashCommandInfo } from "../../slash-commands.ts";
import type { AgentSession } from "../agentsession.ts";

export function do__bindExtensionCore(self: AgentSession, runner: ExtensionRunner): void {
  const getCommands = (): SlashCommandInfo[] => {
    const extensionCommands: SlashCommandInfo[] = runner.getRegisteredCommands().map((command) => ({
      name: command.invocationName,
      description: command.description,
      source: "extension",
      sourceInfo: command.sourceInfo,
    }));

    const templates: SlashCommandInfo[] = self.promptTemplates.map((template) => ({
      name: template.name,
      description: template.description,
      source: "prompt",
      sourceInfo: template.sourceInfo,
    }));

    const skills: SlashCommandInfo[] = self._resourceLoader.getSkills().skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
      sourceInfo: skill.sourceInfo,
    }));

    return [...extensionCommands, ...templates, ...skills];
  };

  runner.bindCore(
    {
      sendMessage: (message, options) => {
        self.sendCustomMessage(message, options).catch((err) => {
          runner.emitError({
            extensionPath: "<runtime>",
            event: "send_message",
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      sendUserMessage: (content, options) => {
        self.sendUserMessage(content, options).catch((err) => {
          runner.emitError({
            extensionPath: "<runtime>",
            event: "send_user_message",
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      appendEntry: (customType, data) => {
        self.sessionManager.appendCustomEntry(customType, data);
      },
      setSessionName: (name) => {
        self.setSessionName(name);
      },
      getSessionName: () => {
        return self.sessionManager.getSessionName();
      },
      setLabel: (entryId, label) => {
        self.sessionManager.appendLabelChange(entryId, label);
      },
      getActiveTools: () => self.getActiveToolNames(),
      getAllTools: () => self.getAllTools(),
      setActiveTools: (toolNames) => self.setActiveToolsByName(toolNames),
      refreshTools: () => self._refreshToolRegistry({ includeAllExtensionTools: self._includeAllExtensionTools }),
      getCommands,
      setModel: async (model) => {
        if (!self.modelRegistry.hasConfiguredAuth(model)) return false;
        await self.setModel(model);
        return true;
      },
      getThinkingLevel: () => self.thinkingLevel,
      setThinkingLevel: (level) => self.setThinkingLevel(level),
    },
    {
      getModel: () => self.model,
      isIdle: () => !self.isStreaming,
      isProjectTrusted: () => self.settingsManager.isProjectTrusted(),
      getSignal: () => self.agent.signal,
      abort: () => {
        if (self._extensionAbortHandler) {
          self._extensionAbortHandler();
          return;
        }
        void self.abort();
      },
      hasPendingMessages: () => self.pendingMessageCount > 0,
      shutdown: () => {
        self._extensionShutdownHandler?.();
      },
      getContextUsage: () => self.getContextUsage(),
      compact: (options) => {
        void (async () => {
          try {
            const result = await self.compact(options?.customInstructions);
            options?.onComplete?.(result);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            options?.onError?.(err);
          }
        })();
      },
      getSystemPrompt: () => self.systemPrompt,
      getSystemPromptOptions: () => self._baseSystemPromptOptions,
    },
    {
      registerProvider: (name, config) => {
        self._modelRegistry.registerProvider(name, config);
        self._refreshCurrentModelFromRegistry();
      },
      unregisterProvider: (name) => {
        self._modelRegistry.unregisterProvider(name);
        self._refreshCurrentModelFromRegistry();
      },
    },
  );
}
