import type { SettingItem } from "@dst0/p-tui";
import type { SettingsConfig } from "./types.ts";

export function createInterfaceSettingsItems(config: SettingsConfig, supportsImages: boolean): SettingItem[] {
  const items: SettingItem[] = [];
  if (supportsImages) {
    items.push(
      {
        id: "show-images",
        label: "Show images",
        description: "Render images inline in terminal",
        currentValue: config.showImages ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "image-width-cells",
        label: "Image width",
        description: "Preferred inline image width in terminal cells",
        currentValue: String(config.imageWidthCells),
        values: ["60", "80", "120"],
      },
    );
  }

  items.push(
    {
      id: "auto-resize-images",
      label: "Auto-resize images",
      description: "Resize large images to 2000x2000 max for better model compatibility",
      currentValue: config.autoResizeImages ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "block-images",
      label: "Block images",
      description: "Prevent images from being sent to LLM providers",
      currentValue: config.blockImages ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "skill-commands",
      label: "Skill commands",
      description: "Register skills as /skill:name commands",
      currentValue: config.enableSkillCommands ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "show-hardware-cursor",
      label: "Show hardware cursor",
      description: "Show the terminal cursor while still positioning it for IME support",
      currentValue: config.showHardwareCursor ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "editor-padding",
      label: "Editor padding",
      description: "Horizontal padding for input editor (0-3)",
      currentValue: String(config.editorPaddingX),
      values: ["0", "1", "2", "3"],
    },
    {
      id: "autocomplete-max-visible",
      label: "Autocomplete max items",
      description: "Max visible items in autocomplete dropdown (3-20)",
      currentValue: String(config.autocompleteMaxVisible),
      values: ["3", "5", "7", "10", "15", "20"],
    },
    {
      id: "clear-on-shrink",
      label: "Clear on shrink",
      description: "Clear empty rows when content shrinks (may cause flicker)",
      currentValue: config.clearOnShrink ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "terminal-progress",
      label: "Terminal progress",
      description: "Show OSC 9;4 progress indicators in the terminal tab bar",
      currentValue: config.showTerminalProgress ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "token-progress",
      label: "Token progress",
      description: "Show compact QUEUED/PREFILL/GEN progress in the footer",
      currentValue: config.showTokenProgress ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "token-stats",
      label: "Token stats",
      description: "Show cumulative ↑↓R W CH token counts in the footer",
      currentValue: config.showTokenStats ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "indexing-info",
      label: "Indexing info",
      description: "Show repository indexing marker and progress percentage in the footer",
      currentValue: config.showIndexingInfo ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "version",
      label: "Show version",
      description: "Show p agent version in the footer",
      currentValue: config.showVersion ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "harness-messages",
      label: "Show harness messages",
      description: "Show internal harness messages",
      currentValue: config.showHarnessMessages ? "true" : "false",
      values: ["true", "false"],
    },
  );
  return items;
}
