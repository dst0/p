import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ProjectTrustContext,
} from "../../../../core/extensions/index.ts";
import { findIndexWorkspaceRoot } from "../../../../core/indexed-repos.ts";
import { formatMissingSessionCwdPrompt, type MissingSessionCwdError } from "../../../../core/session-cwd.ts";
import { ExtensionSelectorComponent } from "../../components/extension-selector.ts";
import {
  getAvailableThemesWithPaths,
  getThemeByName,
  setTheme,
  setThemeInstance,
  Theme,
  theme,
} from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_createProjectTrustContext(self: InteractiveMode, cwd: string): ProjectTrustContext {
  const ui = self.createExtensionUIContext();
  return {
    cwd,
    mode: "tui",
    hasUI: true,
    ui: {
      select: ui.select,
      confirm: ui.confirm,
      input: ui.input,
      notify: ui.notify,
    },
  };
}

export function do_createExtensionUIContext(self: InteractiveMode): ExtensionUIContext {
  return {
    select: (title, options, opts) => self.showExtensionSelector(title, options, opts),
    confirm: (title, message, opts) => self.showExtensionConfirm(title, message, opts),
    input: (title, placeholder, opts) => self.showExtensionInput(title, placeholder, opts),
    notify: (message, type) => self.showExtensionNotify(message, type),
    onTerminalInput: (handler) => self.addExtensionTerminalInputListener(handler),
    setStatus: (key, text) => self.setExtensionStatus(key, text),
    setWorkingMessage: (message) => {
      self.workingMessage = message;
      if (self.loadingAnimation) {
        self.loadingAnimation.setMessage(message ?? self.defaultWorkingMessage);
      }
    },
    setWorkingVisible: (visible) => self.setWorkingVisible(visible),
    setWorkingIndicator: (options) => self.setWorkingIndicator(options),
    setHiddenThinkingLabel: (label) => self.setHiddenThinkingLabel(label),
    setWidget: (key, content, options) => self.setExtensionWidget(key, content, options),
    setFooter: (factory) => self.setExtensionFooter(factory),
    setHeader: (factory) => self.setExtensionHeader(factory),
    setTitle: (title) => self.ui.terminal.setTitle(title),
    custom: (factory, options) => self.showExtensionCustom(factory, options),
    pasteToEditor: (text) => self.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
    setEditorText: (text) => self.editor.setText(text),
    getEditorText: () => self.editor.getExpandedText?.() ?? self.editor.getText(),
    editor: (title, prefill) => self.showExtensionEditor(title, prefill),
    addAutocompleteProvider: (factory) => {
      self.autocompleteProviderWrappers.push(factory);
      self.setupAutocompleteProvider();
    },
    setEditorComponent: (factory) => self.setCustomEditorComponent(factory),
    getEditorComponent: () => self.editorComponentFactory,
    get theme() {
      return theme;
    },
    getAllThemes: () => getAvailableThemesWithPaths(),
    getTheme: (name) => getThemeByName(name),
    setTheme: (themeOrName) => {
      if (themeOrName instanceof Theme) {
        setThemeInstance(themeOrName);
        self.ui.requestRender();
        return { success: true };
      }
      const result = setTheme(themeOrName, true);
      if (result.success) {
        if (self.settingsManager.getTheme() !== themeOrName) {
          self.settingsManager.setTheme(themeOrName);
        }
        self.ui.requestRender();
      }
      return result;
    },
    getToolsExpanded: () => self.toolOutputExpanded,
    setToolsExpanded: (expanded) => self.setToolsExpanded(expanded),
  };
}

export function do_showExtensionSelector(
  self: InteractiveMode,
  title: string,
  options: string[],
  opts?: ExtensionUIDialogOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (opts?.signal?.aborted) {
      resolve(undefined);
      return;
    }

    const onAbort = () => {
      self.hideExtensionSelector();
      resolve(undefined);
    };
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    self.extensionSelector = new ExtensionSelectorComponent(
      title,
      options,
      (option) => {
        opts?.signal?.removeEventListener("abort", onAbort);
        self.hideExtensionSelector();
        resolve(option);
      },
      () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        self.hideExtensionSelector();
        resolve(undefined);
      },
      {
        tui: self.ui,
        timeout: opts?.timeout,
        onToggleToolsExpanded: () => self.toggleToolOutputExpansion(),
      },
    );

    self.editorContainer.clear();
    self.editorContainer.addChild(self.extensionSelector);
    self.ui.setFocus(self.extensionSelector);
    self.ui.requestRender();
  });
}

export function do_hideExtensionSelector(self: InteractiveMode): void {
  self.extensionSelector?.dispose();
  self.editorContainer.clear();
  self.editorContainer.addChild(self.editor);
  self.extensionSelector = undefined;
  self.ui.setFocus(self.editor);
  self.ui.requestRender();
}

export async function do_showExtensionConfirm(
  self: InteractiveMode,
  title: string,
  message: string,
  opts?: ExtensionUIDialogOptions,
): Promise<boolean> {
  const result = await self.showExtensionSelector(`${title}\n${message}`, ["Yes", "No"], opts);
  return result === "Yes";
}

export async function do_promptForMissingSessionCwd(
  self: InteractiveMode,
  error: MissingSessionCwdError,
): Promise<string | undefined> {
  const confirmed = await self.showExtensionConfirm(
    "Session cwd not found",
    formatMissingSessionCwdPrompt(error.issue),
  );
  return confirmed ? error.issue.fallbackCwd : undefined;
}

export async function do_promptForCodeIndexingIfNeeded(self: InteractiveMode): Promise<void> {
  const workspaceRoot = findIndexWorkspaceRoot(self.sessionManager.getCwd());
  if (self.indexingService.getDecision(workspaceRoot) !== "unknown") return;
  const answer = await self.showExtensionSelector("Code indexing", [
    `Yes — index ${workspaceRoot} and keep it updated in the background`,
    "No — do not ask again for self repository",
  ]);
  if (answer?.startsWith("Yes")) {
    self.indexingService.enableIndexing(workspaceRoot);
    self.showStatus("Code indexing enabled; the background service will start indexing self repository");
  } else {
    self.indexingService.disableIndexing(workspaceRoot);
  }
}
