import type { AgentMessage, CustomMessage } from "@dst0/p-agent-core";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInternalCompletionProtocolRepairMessage } from "../src/core/agent-session.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { SettingsSelectorComponent } from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("showHarnessMessages functionality & coverage", () => {
  const testDir = join(process.cwd(), "test-harness-messages-tmp");
  const agentDir = join(testDir, "agent");
  const projectDir = join(testDir, "project");

  beforeEach(() => {
    initTheme("dark");
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(projectDir, ".p"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("isInternalCompletionProtocolRepairMessage helper", () => {
    it("identifies completion protocol repair messages", () => {
      const repairMsg: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "Repair protocol" }],
        timestamp: Date.now(),
        metadata: { pInternal: "completion_protocol_repair" },
      };
      expect(isInternalCompletionProtocolRepairMessage(repairMsg)).toBe(true);
    });

    it("returns false for regular user messages", () => {
      const regularMsg: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "Hello agent" }],
        timestamp: Date.now(),
      };
      expect(isInternalCompletionProtocolRepairMessage(regularMsg)).toBe(false);
    });

    it("returns false for non-user messages", () => {
      const customMsg: CustomMessage = {
        role: "custom",
        customType: "internal_repair",
        content: "repair",
        display: true,
        timestamp: Date.now(),
      };
      expect(isInternalCompletionProtocolRepairMessage(customMsg)).toBe(false);
    });
  });

  describe("SettingsManager showHarnessMessages", () => {
    it("defaults to false", () => {
      const manager = SettingsManager.create(projectDir, agentDir);
      expect(manager.getShowHarnessMessages()).toBe(false);
    });

    it("can be enabled and persisted to terminal.showHarnessMessages", async () => {
      const manager = SettingsManager.create(projectDir, agentDir);
      manager.setShowHarnessMessages(true);
      await manager.flush();

      expect(manager.getShowHarnessMessages()).toBe(true);
      const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
      expect(savedSettings.terminal.showHarnessMessages).toBe(true);
    });

    it("can be toggled from true back to false", async () => {
      const manager = SettingsManager.create(projectDir, agentDir);
      manager.setShowHarnessMessages(true);
      await manager.flush();
      expect(manager.getShowHarnessMessages()).toBe(true);

      manager.setShowHarnessMessages(false);
      await manager.flush();
      expect(manager.getShowHarnessMessages()).toBe(false);
      const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
      expect(savedSettings.terminal.showHarnessMessages).toBe(false);
    });
  });

  describe("SettingsSelectorComponent Integration", () => {
    it("fires onShowHarnessMessagesChange when harness-messages item changes", () => {
      const onShowHarnessMessagesChange = vi.fn();
      const selector = new SettingsSelectorComponent(
        {
          autoCompact: true,
          showImages: true,
          imageWidthCells: 60,
          autoResizeImages: true,
          blockImages: false,
          enableSkillCommands: true,
          steeringMode: "all",
          followUpMode: "all",
          transport: "auto",
          httpIdleTimeoutMs: 30000,
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "minimal", "low", "medium", "high"],
          currentTheme: "dark",
          availableThemes: ["dark", "light"],
          hideThinkingBlock: false,
          collapseChangelog: false,
          enableInstallTelemetry: true,
          doubleEscapeAction: "fork",
          treeFilterMode: "default",
          showHardwareCursor: false,
          editorPaddingX: 1,
          autocompleteMaxVisible: 5,
          quietStartup: false,
          defaultProjectTrust: "ask",
          enableToolResultContextExtraction: true,
          clearOnShrink: false,
          showTerminalProgress: false,
          showTokenProgress: true,
          showTokenStats: true,
          showIndexingInfo: true,
          showVersion: false,
          showHarnessMessages: false,
          warnings: {},
        },
        {
          onAutoCompactChange: () => {},
          onShowImagesChange: () => {},
          onImageWidthCellsChange: () => {},
          onAutoResizeImagesChange: () => {},
          onBlockImagesChange: () => {},
          onEnableSkillCommandsChange: () => {},
          onSteeringModeChange: () => {},
          onFollowUpModeChange: () => {},
          onTransportChange: () => {},
          onHttpIdleTimeoutMsChange: () => {},
          onThinkingLevelChange: () => {},
          onThemeChange: () => {},
          onHideThinkingBlockChange: () => {},
          onCollapseChangelogChange: () => {},
          onEnableInstallTelemetryChange: () => {},
          onDoubleEscapeActionChange: () => {},
          onTreeFilterModeChange: () => {},
          onShowHardwareCursorChange: () => {},
          onEditorPaddingXChange: () => {},
          onAutocompleteMaxVisibleChange: () => {},
          onQuietStartupChange: () => {},
          onDefaultProjectTrustChange: () => {},
          onEnableToolResultContextExtractionChange: () => {},
          onClearOnShrinkChange: () => {},
          onShowTerminalProgressChange: () => {},
          onShowTokenProgressChange: () => {},
          onShowTokenStatsChange: () => {},
          onShowIndexingInfoChange: () => {},
          onShowVersionChange: () => {},
          onShowHarnessMessagesChange,
          onWarningsChange: () => {},
          onCancel: () => {},
        },
      );

      const list = selector.getSettingsList();
      const items = (
        list as unknown as { items: Array<{ id: string; label: string; description?: string; currentValue: string }> }
      ).items;
      const item = items.find((i) => i.id === "harness-messages");
      expect(item).toBeDefined();
      expect(item?.label).toBe("Show harness messages");
      expect(item?.description).toBe("Show internal harness messages");
      expect(item?.currentValue).toBe("false");

      const onChange = (list as unknown as { onChange: (id: string, val: string) => void }).onChange;
      onChange("harness-messages", "true");
      expect(onShowHarnessMessagesChange).toHaveBeenCalledWith(true);

      onChange("harness-messages", "false");
      expect(onShowHarnessMessagesChange).toHaveBeenCalledWith(false);
    });
  });

  describe("Message Gating Logic", () => {
    function shouldDisplayMessage(message: AgentMessage, showHarnessMessages: boolean): boolean {
      if (message.role === "custom") {
        if (message.display) {
          if (message.customType === "internal_repair" && !showHarnessMessages) {
            return false;
          }
          return true;
        }
        return false;
      }
      if (message.role === "user") {
        if (isInternalCompletionProtocolRepairMessage(message) && !showHarnessMessages) {
          return false;
        }
        return true;
      }
      return true;
    }

    it("gates internal_repair custom messages when showHarnessMessages is false", () => {
      const customRepairMsg: CustomMessage = {
        role: "custom",
        customType: "internal_repair",
        content: "repair details",
        display: true,
        timestamp: Date.now(),
      };

      expect(shouldDisplayMessage(customRepairMsg, false)).toBe(false);
      expect(shouldDisplayMessage(customRepairMsg, true)).toBe(true);
    });

    it("gates completion_protocol_repair user messages when showHarnessMessages is false", () => {
      const protocolRepairMsg: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "internal repair" }],
        timestamp: Date.now(),
        metadata: { pInternal: "completion_protocol_repair" },
      };

      expect(shouldDisplayMessage(protocolRepairMsg, false)).toBe(false);
      expect(shouldDisplayMessage(protocolRepairMsg, true)).toBe(true);
    });

    it("allows standard user and custom messages regardless of setting", () => {
      const normalUserMsg: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "Fix the bug" }],
        timestamp: Date.now(),
      };
      const normalCustomMsg: CustomMessage = {
        role: "custom",
        customType: "other_type",
        content: "other content",
        display: true,
        timestamp: Date.now(),
      };

      expect(shouldDisplayMessage(normalUserMsg, false)).toBe(true);
      expect(shouldDisplayMessage(normalUserMsg, true)).toBe(true);
      expect(shouldDisplayMessage(normalCustomMsg, false)).toBe(true);
      expect(shouldDisplayMessage(normalCustomMsg, true)).toBe(true);
    });
  });
});
