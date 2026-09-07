import { VERSION } from "../../../../config.ts";
import { configureHttpDispatcher, formatHttpIdleTimeoutMs } from "../../../../core/http-dispatcher.ts";
import { AssistantMessageComponent } from "../../components/assistant-message.ts";
import { SettingsSelectorComponent } from "../../components/settings-selector.ts";
import { ToolExecutionComponent } from "../../components/tool-execution.ts";
import { getAvailableThemes, setTheme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";
import { handleBudgetCommand } from "./budget-command.ts";

export function do_showSettingsSelector(self: InteractiveMode): void {
  self.showSelector((done) => {
    const selector = new SettingsSelectorComponent(
      {
        runBudgetLabel: self.session.runBudget.policy.mode === "unlimited" ? "Unlimited" : "Limited",
        autoCompact: self.session.autoCompactionEnabled,
        showImages: self.settingsManager.getShowImages(),
        imageWidthCells: self.settingsManager.getImageWidthCells(),
        autoResizeImages: self.settingsManager.getImageAutoResize(),
        blockImages: self.settingsManager.getBlockImages(),
        enableSkillCommands: self.settingsManager.getEnableSkillCommands(),
        steeringMode: self.session.steeringMode,
        followUpMode: self.session.followUpMode,
        transport: self.settingsManager.getTransport(),
        httpIdleTimeoutMs: self.settingsManager.getHttpIdleTimeoutMs(),
        thinkingLevel: self.session.thinkingLevel,
        availableThinkingLevels: self.session.getAvailableThinkingLevels(),
        currentTheme: self.settingsManager.getTheme() || "dark",
        availableThemes: getAvailableThemes(),
        hideThinkingBlock: self.hideThinkingBlock,
        collapseChangelog: self.settingsManager.getCollapseChangelog(),
        enableInstallTelemetry: self.settingsManager.getEnableInstallTelemetry(),
        doubleEscapeAction: self.settingsManager.getDoubleEscapeAction(),
        treeFilterMode: self.settingsManager.getTreeFilterMode(),
        showHardwareCursor: self.settingsManager.getShowHardwareCursor(),
        defaultProjectTrust: self.settingsManager.getDefaultProjectTrust(),
        editorPaddingX: self.settingsManager.getEditorPaddingX(),
        autocompleteMaxVisible: self.settingsManager.getAutocompleteMaxVisible(),
        quietStartup: self.settingsManager.getQuietStartup(),
        enableToolResultContextExtraction: self.settingsManager.isToolResultContextExtractionEnabled(),
        clearOnShrink: self.settingsManager.getClearOnShrink(),
        showTerminalProgress: self.settingsManager.getShowTerminalProgress(),
        showTokenProgress: self.settingsManager.getShowTokenProgress(),
        showTokenStats: self.settingsManager.getShowTokenStats(),
        showIndexingInfo: self.settingsManager.getShowIndexingInfo(),
        enableIndexingTray: self.settingsManager.getEnableIndexingTray(),
        showVersion: self.settingsManager.getShowVersion(),
        showHarnessMessages: self.settingsManager.getShowHarnessMessages(),
        warnings: self.settingsManager.getWarnings(),
      },
      {
        onRunBudgetConfigure: () => {
          done();
          void handleBudgetCommand(self, "/budget");
        },
        onAutoCompactChange: (enabled) => {
          self.session.setAutoCompactionEnabled(enabled);
          self.footer.setAutoCompactEnabled(enabled);
        },
        onShowImagesChange: (enabled) => {
          self.settingsManager.setShowImages(enabled);
          for (const child of self.chatContainer.children) {
            if (child instanceof ToolExecutionComponent) {
              child.setShowImages(enabled);
            }
          }
        },
        onImageWidthCellsChange: (width) => {
          self.settingsManager.setImageWidthCells(width);
          for (const child of self.chatContainer.children) {
            if (child instanceof ToolExecutionComponent) {
              child.setImageWidthCells(width);
            }
          }
        },
        onAutoResizeImagesChange: (enabled) => {
          self.settingsManager.setImageAutoResize(enabled);
        },
        onBlockImagesChange: (blocked) => {
          self.settingsManager.setBlockImages(blocked);
        },
        onEnableSkillCommandsChange: (enabled) => {
          self.settingsManager.setEnableSkillCommands(enabled);
          self.setupAutocompleteProvider();
        },
        onSteeringModeChange: (mode) => {
          self.session.setSteeringMode(mode);
        },
        onFollowUpModeChange: (mode) => {
          self.session.setFollowUpMode(mode);
        },
        onTransportChange: (transport) => {
          self.settingsManager.setTransport(transport);
          self.session.agent.transport = transport;
        },
        onHttpIdleTimeoutMsChange: (timeoutMs) => {
          self.settingsManager.setHttpIdleTimeoutMs(timeoutMs);
          configureHttpDispatcher(timeoutMs);
          self.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
        },
        onThinkingLevelChange: (level) => {
          self.session.setThinkingLevel(level);
          self.footer.invalidate();
          self.updateEditorBorderColor();
        },
        onThemeChange: (themeName) => {
          const result = setTheme(themeName, true);
          self.settingsManager.setTheme(themeName);
          self.updateTerminalBackground();
          self.ui.invalidate();
          if (!result.success) {
            self.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
          }
        },
        onThemePreview: (themeName) => {
          const result = setTheme(themeName, true);
          if (result.success) {
            self.updateTerminalBackground();
            self.ui.invalidate();
            self.ui.requestRender();
          }
        },
        onHideThinkingBlockChange: (hidden) => {
          self.hideThinkingBlock = hidden;
          self.settingsManager.setHideThinkingBlock(hidden);
          for (const child of self.chatContainer.children) {
            if (child instanceof AssistantMessageComponent) {
              child.setHideThinkingBlock(hidden);
            }
          }
          self.chatContainer.clear();
          self.rebuildChatFromMessages();
        },
        onCollapseChangelogChange: (collapsed) => {
          self.settingsManager.setCollapseChangelog(collapsed);
        },
        onEnableInstallTelemetryChange: (enabled) => {
          self.settingsManager.setEnableInstallTelemetry(enabled);
        },
        onQuietStartupChange: (enabled) => {
          self.settingsManager.setQuietStartup(enabled);
        },
        onDefaultProjectTrustChange: (defaultProjectTrust) => {
          self.settingsManager.setDefaultProjectTrust(defaultProjectTrust);
        },
        onEnableToolResultContextExtractionChange: (enabled) => {
          self.settingsManager.setToolResultContextExtractionEnabled(enabled);
        },
        onDoubleEscapeActionChange: (action) => {
          self.settingsManager.setDoubleEscapeAction(action);
        },
        onTreeFilterModeChange: (mode) => {
          self.settingsManager.setTreeFilterMode(mode);
        },
        onShowHardwareCursorChange: (enabled) => {
          self.settingsManager.setShowHardwareCursor(enabled);
          self.ui.setShowHardwareCursor(enabled);
        },
        onEditorPaddingXChange: (padding) => {
          self.settingsManager.setEditorPaddingX(padding);
          self.defaultEditor.setPaddingX(padding);
          if (self.editor !== self.defaultEditor && self.editor.setPaddingX !== undefined) {
            self.editor.setPaddingX(padding);
          }
        },
        onAutocompleteMaxVisibleChange: (maxVisible) => {
          self.settingsManager.setAutocompleteMaxVisible(maxVisible);
          self.defaultEditor.setAutocompleteMaxVisible(maxVisible);
          if (self.editor !== self.defaultEditor && self.editor.setAutocompleteMaxVisible !== undefined) {
            self.editor.setAutocompleteMaxVisible(maxVisible);
          }
        },
        onClearOnShrinkChange: (enabled) => {
          self.settingsManager.setClearOnShrink(enabled);
          self.ui.setClearOnShrink(enabled);
        },
        onShowTerminalProgressChange: (enabled) => {
          self.settingsManager.setShowTerminalProgress(enabled);
        },
        onShowTokenProgressChange: (enabled) => {
          self.settingsManager.setShowTokenProgress(enabled);
          self.footer.setShowTokenProgress(enabled);
          self.ui.requestRender();
        },
        onShowTokenStatsChange: (enabled) => {
          self.settingsManager.setShowTokenStats(enabled);
          self.footer.setShowTokenStats(enabled);
          self.ui.requestRender();
        },
        onShowIndexingInfoChange: (enabled) => {
          self.settingsManager.setShowIndexingInfo(enabled);
          self.footer.setShowIndexingInfo(enabled);
          self.ui.requestRender();
        },
        onEnableIndexingTrayChange: (enabled) => {
          self.settingsManager.setEnableIndexingTray(enabled);
        },
        onShowVersionChange: (enabled) => {
          self.settingsManager.setShowVersion(enabled);
          self.footer.setShowVersion(enabled, VERSION);
          self.ui.requestRender();
        },
        onShowHarnessMessagesChange: (enabled) => {
          self.setShowHarnessMessages(enabled);
          self.ui.requestRender();
        },
        onWarningsChange: (warnings) => {
          self.settingsManager.setWarnings(warnings);
        },
        onCancel: () => {
          done();
          self.ui.requestRender();
        },
      },
    );
    return { component: selector, focus: selector.getSettingsList() };
  });
}
