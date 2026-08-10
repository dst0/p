import { type Component, Container, Spacer, Text } from "@dst0/p-tui";
import { configureHttpDispatcher } from "../../../../core/http-dispatcher.ts";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { setRegisteredThemes, setTheme, theme } from "../../theme/theme.ts";
import { isExpandable } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleReloadCommand(self: InteractiveMode): Promise<void> {
  if (self.session.isStreaming) {
    self.showWarning("Wait for the current response to finish before reloading.");
    return;
  }
  if (self.session.isCompacting) {
    self.showWarning("Wait for compaction to finish before reloading.");
    return;
  }

  self.resetExtensionUI();

  const reloadBox = new Container();
  const borderColor = (s: string) => theme.fg("border", s);
  reloadBox.addChild(new DynamicBorder(borderColor));
  reloadBox.addChild(new Spacer(1));
  reloadBox.addChild(
    new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0),
  );
  reloadBox.addChild(new Spacer(1));
  reloadBox.addChild(new DynamicBorder(borderColor));

  const previousEditor = self.editor;
  self.editorContainer.clear();
  self.editorContainer.addChild(reloadBox);
  self.ui.setFocus(reloadBox);
  self.ui.requestRender(true);
  await new Promise((resolve) => process.nextTick(resolve));

  const dismissReloadBox = (editor: Component) => {
    self.editorContainer.clear();
    self.editorContainer.addChild(editor);
    self.ui.setFocus(editor);
    self.ui.requestRender();
  };

  try {
    await self.session.reload();
    configureHttpDispatcher(self.settingsManager.getHttpIdleTimeoutMs());
    self.keybindings.reload();
    const activeHeader = self.customHeader ?? self.builtInHeader;
    if (isExpandable(activeHeader)) {
      activeHeader.setExpanded(self.toolOutputExpanded);
    }
    setRegisteredThemes(self.session.resourceLoader.getThemes().themes);
    self.hideThinkingBlock = self.settingsManager.getHideThinkingBlock();
    const themeName = self.settingsManager.getTheme();
    const themeResult = themeName ? setTheme(themeName, true) : { success: true };
    if (!themeResult.success) {
      self.showError(`Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`);
    }
    const editorPaddingX = self.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = self.settingsManager.getAutocompleteMaxVisible();
    self.defaultEditor.setPaddingX(editorPaddingX);
    self.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
    if (self.editor !== self.defaultEditor) {
      self.editor.setPaddingX?.(editorPaddingX);
      self.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
    }
    self.ui.setShowHardwareCursor(self.settingsManager.getShowHardwareCursor());
    self.ui.setClearOnShrink(self.settingsManager.getClearOnShrink());
    self.setupAutocompleteProvider();
    const runner = self.session.extensionRunner;
    self.setupExtensionShortcuts(runner);
    self.rebuildChatFromMessages();
    dismissReloadBox(self.editor as Component);
    self.showLoadedResources({
      force: false,
      showDiagnosticsWhenQuiet: true,
    });
    const savedImplicitProjectTrust = self.maybeSaveImplicitProjectTrustAfterReload();
    const modelsJsonError = self.session.modelRegistry.getError();
    if (modelsJsonError) {
      self.showError(`models.json error: ${modelsJsonError}`);
    }
    self.showStatus(
      savedImplicitProjectTrust
        ? "Reloaded keybindings, extensions, skills, prompts, themes; saved project trust"
        : "Reloaded keybindings, extensions, skills, prompts, themes",
    );
  } catch (error) {
    dismissReloadBox(previousEditor as Component);
    self.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function do_handleExportCommand(self: InteractiveMode, text: string): Promise<void> {
  const outputPath = self.getPathCommandArgument(text, "/export");

  try {
    if (outputPath?.endsWith(".jsonl")) {
      const filePath = self.session.exportToJsonl(outputPath);
      self.showStatus(`Session exported to: ${filePath}`);
    } else {
      const filePath = await self.session.exportToHtml(outputPath);
      self.showStatus(`Session exported to: ${filePath}`);
    }
  } catch (error: unknown) {
    self.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export function do_getPathCommandArgument(
  _self: InteractiveMode,
  text: string,
  command: "/export" | "/import",
): string | undefined {
  if (text === command) {
    return undefined;
  }
  if (!text.startsWith(`${command} `)) {
    return undefined;
  }

  const argsString = text.slice(command.length + 1).trimStart();
  if (!argsString) {
    return undefined;
  }

  const firstChar = argsString[0];
  if (firstChar === '"' || firstChar === "'") {
    const closingQuoteIndex = argsString.indexOf(firstChar, 1);
    if (closingQuoteIndex < 0) {
      return undefined;
    }
    return argsString.slice(1, closingQuoteIndex);
  }

  const firstWhitespaceIndex = argsString.search(/\s/);
  if (firstWhitespaceIndex < 0) {
    return argsString;
  }
  return argsString.slice(0, firstWhitespaceIndex);
}
