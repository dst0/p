import { Markdown, Spacer, Text } from "@dst0/p-tui";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_setupAutocompleteProvider(self: InteractiveMode): void {
  let provider = self.createBaseAutocompleteProvider();
  const triggerCharacters: string[] = [];
  for (const wrapProvider of self.autocompleteProviderWrappers) {
    provider = wrapProvider(provider);
    triggerCharacters.push(...(provider.triggerCharacters ?? []));
  }
  if (triggerCharacters.length > 0) {
    provider.triggerCharacters = [...new Set(triggerCharacters)];
  }

  self.autocompleteProvider = provider;
  self.defaultEditor.setAutocompleteProvider(provider);
  if (self.editor !== self.defaultEditor) {
    self.editor.setAutocompleteProvider?.(provider);
  }
}

export function do_showStartupNoticesIfNeeded(self: InteractiveMode): void {
  if (!self.settingsManager.getStartupNotices()) {
    return;
  }
  if (self.startupNoticesShown) {
    return;
  }
  self.startupNoticesShown = true;

  if (!self.changelogMarkdown) {
    return;
  }

  if (self.chatContainer.children.length > 0) {
    self.chatContainer.addChild(new Spacer(1));
  }
  self.chatContainer.addChild(new DynamicBorder());
  if (self.settingsManager.getCollapseChangelog()) {
    const versionMatch = self.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
    const latestVersion = versionMatch ? versionMatch[1] : self.version;
    const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
    self.chatContainer.addChild(new Text(condensedText, 1, 0));
  } else {
    self.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
    self.chatContainer.addChild(new Spacer(1));
    self.chatContainer.addChild(new Markdown(self.changelogMarkdown.trim(), 1, 0, self.getMarkdownThemeWithSettings()));
    self.chatContainer.addChild(new Spacer(1));
  }
  self.chatContainer.addChild(new DynamicBorder());
}
