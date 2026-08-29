import type { AgentMessage, CustomMessage } from "@dst0/p-agent-core";
import { Container } from "@dst0/p-tui";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInternalAgentMessage } from "../src/core/agent-session.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { formatEditResult } from "../src/core/tools/edit.ts";
import { getTextOutput, stripHarnessMessages } from "../src/core/tools/render-utils.ts";
import { createWriteToolDefinition, formatWriteResult } from "../src/core/tools/write.ts";
import { SettingsSelectorComponent } from "../src/modes/interactive/components/settings-selector.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

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

  describe("isInternalAgentMessage helper", () => {
    it("identifies completion protocol repair messages", () => {
      const repairMsg: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "Repair protocol" }],
        timestamp: Date.now(),
        metadata: { pInternal: "completion_protocol_repair" },
      };
      expect(isInternalAgentMessage(repairMsg)).toBe(true);
    });

    it("returns false for regular user messages", () => {
      const regularMsg: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: "Hello agent" }],
        timestamp: Date.now(),
      };
      expect(isInternalAgentMessage(regularMsg)).toBe(false);
    });

    it("returns false for non-user messages", () => {
      const customMsg: CustomMessage = {
        role: "custom",
        customType: "internal_repair",
        content: "repair",
        display: true,
        timestamp: Date.now(),
      };
      expect(isInternalAgentMessage(customMsg)).toBe(false);
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
        if (isInternalAgentMessage(message) && !showHarnessMessages) {
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

  describe("Tool Output Harness Message Filtering", () => {
    const evidenceLine =
      "Verification evidence handle: verification-evidence-414 (@VGCiyJEeuEctpwRatH3kdS4uSULCw90q, ctx_search, mutation revision 0).";
    const sampleOutput = `Found 2 matches in src/main.rs:\nline 10: fn main()\n${evidenceLine}`;

    it("stripHarnessMessages removes Verification evidence handle lines", () => {
      const stripped = stripHarnessMessages(sampleOutput);
      expect(stripped).not.toContain(evidenceLine);
      expect(stripped).toContain("Found 2 matches in src/main.rs:");
    });

    it("getTextOutput filters Verification evidence handle lines when showHarnessMessages is false", () => {
      const result = {
        content: [{ type: "text", text: sampleOutput }],
      };
      const textDefault = getTextOutput(result, false);
      expect(textDefault).not.toContain(evidenceLine);
      expect(textDefault).toContain("Found 2 matches in src/main.rs:");

      const textExplicitFalse = getTextOutput(result, false, false);
      expect(textExplicitFalse).not.toContain(evidenceLine);
    });

    it("getTextOutput includes Verification evidence handle lines when showHarnessMessages is true", () => {
      const result = {
        content: [{ type: "text", text: sampleOutput }],
      };
      const textTrue = getTextOutput(result, false, true);
      expect(textTrue).toContain(evidenceLine);
    });

    it("formatEditResult filters harness messages on error when showHarnessMessages is false", () => {
      initTheme("dark");
      const errorContent = `Edit failed: File not found\n${evidenceLine}`;
      const result = {
        content: [{ type: "text", text: errorContent }],
      };
      const formattedFalse = formatEditResult(undefined, undefined, result, theme, true, false);
      expect(formattedFalse).not.toContain(evidenceLine);
      expect(formattedFalse).toContain("Edit failed: File not found");

      const formattedTrue = formatEditResult(undefined, undefined, result, theme, true, true);
      expect(formattedTrue).toContain(evidenceLine);
    });

    it("formatWriteResult and writeTool.renderResult filter harness messages when showHarnessMessages is false", () => {
      initTheme("dark");
      const errorContent = `Write failed: Permission denied\n${evidenceLine}`;
      const result = {
        content: [{ type: "text" as const, text: errorContent }],
        details: undefined,
      };
      const formattedFalse = formatWriteResult({ ...result, isError: true }, theme, false);
      expect(formattedFalse).not.toContain(evidenceLine);
      expect(formattedFalse).toContain("Write failed: Permission denied");

      const formattedTrue = formatWriteResult({ ...result, isError: true }, theme, true);
      expect(formattedTrue).toContain(evidenceLine);

      const writeTool = createWriteToolDefinition(process.cwd());
      const renderContext = {
        isError: true,
        showHarnessMessages: false,
        lastComponent: undefined,
        expanded: false,
        isPartial: false,
        argsComplete: true,
        cwd: process.cwd(),
        details: undefined,
      };
      const component = writeTool.renderResult?.(
        result,
        { expanded: false, isPartial: false },
        theme,
        renderContext as any,
      );
      expect(component).toBeDefined();
    });

    it("ToolExecutionComponent.setShowHarnessMessages updates state and display", () => {
      initTheme("dark");
      const comp = new ToolExecutionComponent(
        "read",
        "tool-1",
        { path: "test.txt" },
        { showHarnessMessages: false },
        undefined,
        { requestRender: () => {} } as any,
        process.cwd(),
      );
      comp.updateResult({ content: [{ type: "text", text: sampleOutput }], isError: false });

      comp.setShowHarnessMessages(true);
      const textOutput = getTextOutput((comp as any).result, false, (comp as any).showHarnessMessages);
      expect(textOutput).toContain(evidenceLine);

      comp.setShowHarnessMessages(false);
      const textOutputFalse = getTextOutput((comp as any).result, false, (comp as any).showHarnessMessages);
      expect(textOutputFalse).not.toContain(evidenceLine);
    });

    it("toggling showHarnessMessages updates ToolExecutionComponent children in container", () => {
      initTheme("dark");
      const chatContainer = new Container();
      const comp = new ToolExecutionComponent(
        "read",
        "tool-1",
        { path: "test.txt" },
        { showHarnessMessages: false },
        undefined,
        { requestRender: () => {} } as any,
        process.cwd(),
      );
      comp.updateResult({ content: [{ type: "text", text: sampleOutput }], isError: false });
      chatContainer.addChild(comp);

      const onShowHarnessMessagesChange = (enabled: boolean) => {
        for (const child of chatContainer.children) {
          if (child instanceof ToolExecutionComponent) {
            child.setShowHarnessMessages(enabled);
          }
        }
      };

      onShowHarnessMessagesChange(true);
      const textOutputTrue = getTextOutput((comp as any).result, false, (comp as any).showHarnessMessages);
      expect(textOutputTrue).toContain(evidenceLine);

      onShowHarnessMessagesChange(false);
      const textOutputFalse = getTextOutput((comp as any).result, false, (comp as any).showHarnessMessages);
      expect(textOutputFalse).not.toContain(evidenceLine);
    });

    it("InteractiveMode.setShowHarnessMessages updates settings and child ToolExecutionComponent instances", () => {
      initTheme("dark");
      const manager = SettingsManager.create(projectDir, agentDir);
      const chatContainer = new Container();
      const comp = new ToolExecutionComponent(
        "read",
        "tool-1",
        { path: "test.txt" },
        { showHarnessMessages: false },
        undefined,
        { requestRender: () => {} } as any,
        process.cwd(),
      );
      comp.updateResult({ content: [{ type: "text", text: sampleOutput }], isError: false });
      chatContainer.addChild(comp);

      const fakeInteractiveMode = {
        settingsManager: manager,
        chatContainer,
        rebuildChatFromMessages: vi.fn(),
        ui: { requestRender: vi.fn() },
      };

      InteractiveMode.prototype.setShowHarnessMessages.call(fakeInteractiveMode as any, true);
      expect(manager.getShowHarnessMessages()).toBe(true);
      expect(getTextOutput((comp as any).result, false, (comp as any).showHarnessMessages)).toContain(evidenceLine);

      InteractiveMode.prototype.setShowHarnessMessages.call(fakeInteractiveMode as any, false);
      expect(manager.getShowHarnessMessages()).toBe(false);
      expect(getTextOutput((comp as any).result, false, (comp as any).showHarnessMessages)).not.toContain(evidenceLine);
    });

    it("showSettingsSelector wires onShowHarnessMessagesChange callback to setShowHarnessMessages", () => {
      initTheme("dark");
      const manager = SettingsManager.create(projectDir, agentDir);
      let selectorComponent: any;
      const fakeInteractiveMode = {
        settingsManager: manager,
        chatContainer: new Container(),
        editorContainer: new Container(),
        editor: new Container(),
        session: {
          autoCompactionEnabled: true,
          steeringMode: "all",
          followUpMode: "all",
          thinkingLevel: "medium",
          getAvailableThinkingLevels: () => ["off", "minimal", "low", "medium", "high"],
        },
        hideThinkingBlock: false,
        rebuildChatFromMessages: vi.fn(),
        ui: { requestRender: vi.fn(), setFocus: vi.fn() },
        footer: { invalidate: vi.fn(), setShowIndexingInfo: vi.fn(), setShowVersion: vi.fn() },
        showSelector: (fn: (done: () => void) => any) => {
          const res = fn(() => {});
          selectorComponent = res.component;
        },
        setShowHarnessMessages: vi.fn(),
        updateEditorBorderColor: vi.fn(),
      };

      (InteractiveMode.prototype as any).showSettingsSelector.call(fakeInteractiveMode);
      selectorComponent.callbacks.onShowHarnessMessagesChange(true);
      selectorComponent.callbacks.onWarningsChange({});
      expect(fakeInteractiveMode.setShowHarnessMessages).toHaveBeenCalledWith(true);
    });
  });
});
