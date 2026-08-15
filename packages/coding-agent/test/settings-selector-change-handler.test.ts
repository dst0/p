import { describe, expect, test, vi } from "vitest";
import { HTTP_IDLE_TIMEOUT_CHOICES } from "../src/core/http-dispatcher.ts";
import { DEFAULT_PROJECT_TRUST_BY_LABEL } from "../src/modes/interactive/components/settings-selector/constants.ts";
import { createSettingChangeHandler } from "../src/modes/interactive/components/settings-selector/setting-change-handler.ts";
import type { SettingsCallbacks } from "../src/modes/interactive/components/settings-selector/types.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_showSettingsSelector } from "../src/modes/interactive/interactive-mode/interactivemode-methods/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createCallbacks(): SettingsCallbacks {
  return {
    onAutoCompactChange: vi.fn(),
    onShowImagesChange: vi.fn(),
    onImageWidthCellsChange: vi.fn(),
    onAutoResizeImagesChange: vi.fn(),
    onBlockImagesChange: vi.fn(),
    onEnableSkillCommandsChange: vi.fn(),
    onSteeringModeChange: vi.fn(),
    onFollowUpModeChange: vi.fn(),
    onTransportChange: vi.fn(),
    onHttpIdleTimeoutMsChange: vi.fn(),
    onThinkingLevelChange: vi.fn(),
    onThemeChange: vi.fn(),
    onThemePreview: vi.fn(),
    onHideThinkingBlockChange: vi.fn(),
    onCollapseChangelogChange: vi.fn(),
    onEnableInstallTelemetryChange: vi.fn(),
    onDoubleEscapeActionChange: vi.fn(),
    onTreeFilterModeChange: vi.fn(),
    onShowHardwareCursorChange: vi.fn(),
    onEditorPaddingXChange: vi.fn(),
    onAutocompleteMaxVisibleChange: vi.fn(),
    onQuietStartupChange: vi.fn(),
    onDefaultProjectTrustChange: vi.fn(),
    onEnableToolResultContextExtractionChange: vi.fn(),
    onClearOnShrinkChange: vi.fn(),
    onShowTerminalProgressChange: vi.fn(),
    onShowTokenProgressChange: vi.fn(),
    onShowTokenStatsChange: vi.fn(),
    onShowIndexingInfoChange: vi.fn(),
    onEnableIndexingTrayChange: vi.fn(),
    onShowVersionChange: vi.fn(),
    onShowHarnessMessagesChange: vi.fn(),
    onWarningsChange: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("settings selector change handler", () => {
  test("routes every scalar setting to the matching typed callback", () => {
    const callbacks = createCallbacks();
    const handleChange = createSettingChangeHandler(callbacks);
    const timeoutChoice = HTTP_IDLE_TIMEOUT_CHOICES[0];
    const trustChoice = [...DEFAULT_PROJECT_TRUST_BY_LABEL.entries()][0];
    const cases: Array<{
      id: string;
      value: string;
      callback: keyof SettingsCallbacks;
      expected: unknown;
    }> = [
      { id: "autocompact", value: "true", callback: "onAutoCompactChange", expected: true },
      { id: "show-images", value: "false", callback: "onShowImagesChange", expected: false },
      { id: "image-width-cells", value: "120", callback: "onImageWidthCellsChange", expected: 120 },
      { id: "auto-resize-images", value: "true", callback: "onAutoResizeImagesChange", expected: true },
      { id: "block-images", value: "true", callback: "onBlockImagesChange", expected: true },
      { id: "skill-commands", value: "true", callback: "onEnableSkillCommandsChange", expected: true },
      { id: "steering-mode", value: "all", callback: "onSteeringModeChange", expected: "all" },
      { id: "follow-up-mode", value: "one-at-a-time", callback: "onFollowUpModeChange", expected: "one-at-a-time" },
      { id: "transport", value: "websocket", callback: "onTransportChange", expected: "websocket" },
      {
        id: "http-idle-timeout",
        value: timeoutChoice.label,
        callback: "onHttpIdleTimeoutMsChange",
        expected: timeoutChoice.timeoutMs,
      },
      { id: "hide-thinking", value: "true", callback: "onHideThinkingBlockChange", expected: true },
      { id: "collapse-changelog", value: "true", callback: "onCollapseChangelogChange", expected: true },
      { id: "quiet-startup", value: "true", callback: "onQuietStartupChange", expected: true },
      { id: "install-telemetry", value: "true", callback: "onEnableInstallTelemetryChange", expected: true },
      {
        id: "default-project-trust",
        value: trustChoice[0],
        callback: "onDefaultProjectTrustChange",
        expected: trustChoice[1],
      },
      {
        id: "tool-result-extraction",
        value: "true",
        callback: "onEnableToolResultContextExtractionChange",
        expected: true,
      },
      { id: "double-escape-action", value: "tree", callback: "onDoubleEscapeActionChange", expected: "tree" },
      { id: "tree-filter-mode", value: "all", callback: "onTreeFilterModeChange", expected: "all" },
      { id: "show-hardware-cursor", value: "true", callback: "onShowHardwareCursorChange", expected: true },
      { id: "editor-padding", value: "3", callback: "onEditorPaddingXChange", expected: 3 },
      { id: "autocomplete-max-visible", value: "15", callback: "onAutocompleteMaxVisibleChange", expected: 15 },
      { id: "clear-on-shrink", value: "true", callback: "onClearOnShrinkChange", expected: true },
      { id: "terminal-progress", value: "true", callback: "onShowTerminalProgressChange", expected: true },
      { id: "token-progress", value: "true", callback: "onShowTokenProgressChange", expected: true },
      { id: "token-stats", value: "true", callback: "onShowTokenStatsChange", expected: true },
      { id: "indexing-info", value: "true", callback: "onShowIndexingInfoChange", expected: true },
      { id: "indexing-tray", value: "true", callback: "onEnableIndexingTrayChange", expected: true },
      { id: "version", value: "true", callback: "onShowVersionChange", expected: true },
      { id: "harness-messages", value: "true", callback: "onShowHarnessMessagesChange", expected: true },
    ];

    for (const entry of cases) {
      handleChange(entry.id, entry.value);
      expect(callbacks[entry.callback]).toHaveBeenLastCalledWith(entry.expected);
    }
  });

  test("ignores unknown option labels without calling their callbacks", () => {
    const callbacks = createCallbacks();
    const handleChange = createSettingChangeHandler(callbacks);

    handleChange("http-idle-timeout", "invalid");
    handleChange("default-project-trust", "invalid");
    handleChange("unknown", "true");

    expect(callbacks.onHttpIdleTimeoutMsChange).not.toHaveBeenCalled();
    expect(callbacks.onDefaultProjectTrustChange).not.toHaveBeenCalled();
  });

  test("do_showSettingsSelector wires onEnableIndexingTrayChange to setEnableIndexingTray", () => {
    initTheme("dark");
    let capturedComponent: { callbacks: SettingsCallbacks } | undefined;
    const mockSettingsManager = {
      getShowImages: () => false,
      getImageWidthCells: () => 80,
      getImageAutoResize: () => true,
      getBlockImages: () => false,
      getEnableSkillCommands: () => false,
      getTransport: () => "auto",
      getHttpIdleTimeoutMs: () => 30000,
      getTheme: () => "dark",
      getCollapseChangelog: () => false,
      getEnableInstallTelemetry: () => true,
      getDoubleEscapeAction: () => "cancel",
      getTreeFilterMode: () => "all",
      getShowHardwareCursor: () => false,
      getDefaultProjectTrust: () => "trusted",
      getEditorPaddingX: () => 1,
      getAutocompleteMaxVisible: () => 10,
      getQuietStartup: () => false,
      isToolResultContextExtractionEnabled: () => false,
      getClearOnShrink: () => true,
      getShowTerminalProgress: () => true,
      getShowTokenProgress: () => true,
      getShowTokenStats: () => true,
      getShowIndexingInfo: () => true,
      getEnableIndexingTray: () => true,
      getShowVersion: () => false,
      getShowHarnessMessages: () => false,
      getWarnings: () => ({}),
      setEnableIndexingTray: vi.fn(),
    };

    const mockInteractive = {
      settingsManager: mockSettingsManager,
      session: {
        autoCompactionEnabled: true,
        steeringMode: "all",
        followUpMode: "all",
        thinkingLevel: "medium",
        getAvailableThinkingLevels: () => ["medium"],
      },
      hideThinkingBlock: false,
      showSelector: (factory: (done: () => void) => { component: { callbacks: SettingsCallbacks } }) => {
        const result = factory(() => {});
        capturedComponent = result.component;
      },
    } as unknown as InteractiveMode;

    do_showSettingsSelector(mockInteractive);
    expect(capturedComponent?.callbacks.onEnableIndexingTrayChange).toBeDefined();
    capturedComponent!.callbacks.onEnableIndexingTrayChange!(false);
    expect(mockSettingsManager.setEnableIndexingTray).toHaveBeenCalledWith(false);
  });
});
