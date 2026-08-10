import { configureHttpDispatcher } from "../../../../core/http-dispatcher.ts";
import { setRegisteredThemes, stopThemeWatcher } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_bindCurrentSessionExtensions(self: InteractiveMode): Promise<void> {
  const uiContext = self.createExtensionUIContext();
  await self.session.bindExtensions({
    uiContext,
    mode: "tui",
    abortHandler: () => {
      self.restoreQueuedMessagesToEditor({ abort: true });
    },
    commandContextActions: {
      waitForIdle: () => self.session.agent.waitForIdle(),
      newSession: async (options) => {
        if (self.loadingAnimation) {
          self.loadingAnimation.stop();
          self.loadingAnimation = undefined;
        }
        self.statusContainer.clear();
        try {
          const result = await self.runtimeHost.newSession(options);
          if (!result.cancelled) {
            self.renderCurrentSessionState();
            self.ui.requestRender();
          }
          return result;
        } catch (error: unknown) {
          return self.handleFatalRuntimeError("Failed to create session", error);
        }
      },
      fork: async (entryId, options) => {
        try {
          const result = await self.runtimeHost.fork(entryId, options);
          if (!result.cancelled) {
            self.renderCurrentSessionState();
            self.editor.setText(result.selectedText ?? "");
            self.showStatus("Forked to new session");
          }
          return { cancelled: result.cancelled };
        } catch (error: unknown) {
          return self.handleFatalRuntimeError("Failed to fork session", error);
        }
      },
      navigateTree: async (targetId, options) => {
        const result = await self.session.navigateTree(targetId, {
          summarize: options?.summarize,
          customInstructions: options?.customInstructions,
          replaceInstructions: options?.replaceInstructions,
          label: options?.label,
        });
        if (result.cancelled) {
          return { cancelled: true };
        }

        self.chatContainer.clear();
        self.renderInitialMessages();
        if (result.editorText && !self.editor.getText().trim()) {
          self.editor.setText(result.editorText);
        }
        self.showStatus("Navigated to selected point");
        void self.flushCompactionQueue({ willRetry: false });
        return { cancelled: false };
      },
      switchSession: async (sessionPath, options) => {
        return self.handleResumeSession(sessionPath, options);
      },
      reload: async () => {
        await self.handleReloadCommand();
      },
    },
    shutdownHandler: () => {
      self.shutdownRequested = true;
      if (!self.session.isStreaming) {
        void self.shutdown();
      }
    },
    onError: (error) => {
      self.showExtensionError(error.extensionPath, error.error, error.stack);
    },
  });

  setRegisteredThemes(self.session.resourceLoader.getThemes().themes);
  self.setupAutocompleteProvider();

  const extensionRunner = self.session.extensionRunner;
  self.setupExtensionShortcuts(extensionRunner);
  self.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
  self.showStartupNoticesIfNeeded();
}

export function do_applyRuntimeSettings(self: InteractiveMode): void {
  configureHttpDispatcher(self.settingsManager.getHttpIdleTimeoutMs());
  self.footer.setSession(self.session);
  self.footer.setAutoCompactEnabled(self.session.autoCompactionEnabled);
  self.footer.setShowTokenProgress(self.settingsManager.getShowTokenProgress());
  self.footer.setShowVersion(self.settingsManager.getShowVersion(), self.version);
  self.footer.setShowTokenStats(self.settingsManager.getShowTokenStats());
  self.footer.setShowIndexingInfo(self.settingsManager.getShowIndexingInfo());
  self.footerDataProvider.setCwd(self.sessionManager.getCwd());
  self.hideThinkingBlock = self.settingsManager.getHideThinkingBlock();
  self.ui.setShowHardwareCursor(self.settingsManager.getShowHardwareCursor());
  self.ui.setClearOnShrink(self.settingsManager.getClearOnShrink());
  const editorPaddingX = self.settingsManager.getEditorPaddingX();
  const autocompleteMaxVisible = self.settingsManager.getAutocompleteMaxVisible();
  self.defaultEditor.setPaddingX(editorPaddingX);
  self.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
  if (self.editor !== self.defaultEditor) {
    self.editor.setPaddingX?.(editorPaddingX);
    self.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
  }
}

export async function do_rebindCurrentSession(self: InteractiveMode): Promise<void> {
  self.unsubscribe?.();
  self.unsubscribe = undefined;
  self.applyRuntimeSettings();
  await self.bindCurrentSessionExtensions();
  self.subscribeToAgent();
  await self.updateAvailableProviderCount();
  self.updateEditorBorderColor();
  self.updateTerminalTitle();
  if (self.isInitialized && !self.codeIndexingPrompt) {
    const prompt = self.promptForCodeIndexingIfNeeded();
    self.codeIndexingPrompt = prompt;
    void prompt
      .catch((error) => {
        self.showError(`Code indexing prompt failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (self.codeIndexingPrompt === prompt) self.codeIndexingPrompt = undefined;
      });
  }
}

export async function do_handleFatalRuntimeError(
  self: InteractiveMode,
  prefix: string,
  error: unknown,
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  self.showError(`${prefix}: ${message}`);
  stopThemeWatcher();
  self.stop();
  process.exit(1);
}

export function do_renderCurrentSessionState(self: InteractiveMode): void {
  self.chatContainer.clear();
  self.pendingMessagesContainer.clear();
  self.compactionQueuedMessages = [];
  self.streamingComponent = undefined;
  self.streamingMessage = undefined;
  self.pendingTools.clear();
  self.renderInitialMessages();
}

export function do_getRegisteredToolDefinition(self: InteractiveMode, toolName: string) {
  return self.session.getToolDefinition(toolName);
}
