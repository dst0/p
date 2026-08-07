import type { KeyId } from "@dst0/p-tui";
import {
  type Component,
  Container,
  Loader,
  type LoaderIndicatorOptions,
  matchesKey,
  Text,
  type TUI,
} from "@dst0/p-tui";
import type { ExtensionContext, ExtensionRunner, ExtensionWidgetOptions } from "../../../../core/extensions/index.ts";
import { AssistantMessageComponent } from "../../components/assistant-message.ts";
import { type Theme, theme } from "../../theme/theme.ts";
import { InteractiveMode } from "../interactivemode.ts";

export function do_setupExtensionShortcuts(self: InteractiveMode, extensionRunner: ExtensionRunner): void {
  const shortcuts = extensionRunner.getShortcuts(self.keybindings.getEffectiveConfig());
  if (shortcuts.size === 0) return;

  // Create a context for shortcut handlers
  const createContext = (): ExtensionContext => ({
    ui: self.createExtensionUIContext(),
    mode: "tui",
    hasUI: true,
    cwd: self.sessionManager.getCwd(),
    sessionManager: self.sessionManager,
    modelRegistry: self.session.modelRegistry,
    model: self.session.model,
    isIdle: () => !self.session.isStreaming,
    isProjectTrusted: () => self.settingsManager.isProjectTrusted(),
    signal: self.session.agent.signal,
    abort: () => {
      self.restoreQueuedMessagesToEditor({ abort: true });
    },
    hasPendingMessages: () => self.session.pendingMessageCount > 0,
    shutdown: () => {
      self.shutdownRequested = true;
    },
    getContextUsage: () => self.session.getContextUsage(),
    compact: (options) => {
      void (async () => {
        try {
          const result = await self.session.compact(options?.customInstructions);
          options?.onComplete?.(result);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          options?.onError?.(err);
        }
      })();
    },
    getSystemPrompt: () => self.session.systemPrompt,
  });

  // Set up the extension shortcut handler on the default editor
  self.defaultEditor.onExtensionShortcut = (data: string) => {
    for (const [shortcutStr, shortcut] of shortcuts) {
      // Cast to KeyId - extension shortcuts use the same format
      if (matchesKey(data, shortcutStr as KeyId)) {
        // Run handler async, don't block input
        Promise.resolve(shortcut.handler(createContext())).catch((err) => {
          self.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
        });
        return true;
      }
    }
    return false;
  };
}

export function do_setExtensionStatus(self: InteractiveMode, key: string, text: string | undefined): void {
  self.footerDataProvider.setExtensionStatus(key, text);
  self.ui.requestRender();
}

export function do_getWorkingLoaderMessage(self: InteractiveMode): string {
  return self.workingMessage ?? self.defaultWorkingMessage;
}

export function do_createWorkingLoader(self: InteractiveMode): Loader {
  return new Loader(
    self.ui,
    (spinner) => theme.fg("accent", spinner),
    (text) => theme.fg("muted", text),
    self.getWorkingLoaderMessage(),
    self.workingIndicatorOptions,
  );
}

export function do_stopWorkingLoader(self: InteractiveMode): void {
  if (self.loadingAnimation) {
    self.loadingAnimation.stop();
    self.loadingAnimation = undefined;
  }
  self.statusContainer.clear();
}

export function do_setWorkingVisible(self: InteractiveMode, visible: boolean): void {
  self.workingVisible = visible;
  if (!visible) {
    self.stopWorkingLoader();
    self.ui.requestRender();
    return;
  }
  if (self.session.isStreaming && !self.loadingAnimation) {
    self.statusContainer.clear();
    self.loadingAnimation = self.createWorkingLoader();
    self.statusContainer.addChild(self.loadingAnimation);
  }
  self.ui.requestRender();
}

export function do_setWorkingIndicator(self: InteractiveMode, options?: LoaderIndicatorOptions): void {
  self.workingIndicatorOptions = options;
  self.loadingAnimation?.setIndicator(options);
  self.ui.requestRender();
}

export function do_setHiddenThinkingLabel(self: InteractiveMode, label?: string): void {
  self.hiddenThinkingLabel = label ?? self.defaultHiddenThinkingLabel;
  for (const child of self.chatContainer.children) {
    if (child instanceof AssistantMessageComponent) {
      child.setHiddenThinkingLabel(self.hiddenThinkingLabel);
    }
  }
  if (self.streamingComponent) {
    self.streamingComponent.setHiddenThinkingLabel(self.hiddenThinkingLabel);
  }
  self.ui.requestRender();
}

export function do_setExtensionWidget(
  self: InteractiveMode,
  key: string,
  content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
  options?: ExtensionWidgetOptions,
): void {
  const placement = options?.placement ?? "aboveEditor";
  const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
    const existing = map.get(key);
    if (existing?.dispose) existing.dispose();
    map.delete(key);
  };

  removeExisting(self.extensionWidgetsAbove);
  removeExisting(self.extensionWidgetsBelow);

  if (content === undefined) {
    self.renderWidgets();
    return;
  }

  let component: Component & { dispose?(): void };

  if (Array.isArray(content)) {
    // Wrap string array in a Container with Text components
    const container = new Container();
    for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
      container.addChild(new Text(line, 1, 0));
    }
    if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
      container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
    }
    component = container;
  } else {
    // Factory function - create component
    component = content(self.ui, theme);
  }

  const targetMap = placement === "belowEditor" ? self.extensionWidgetsBelow : self.extensionWidgetsAbove;
  targetMap.set(key, component);
  self.renderWidgets();
}
