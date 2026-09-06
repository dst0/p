import type { ThinkingLevel } from "@dst0/p-agent-core";
import { getCapabilities, type SettingItem } from "@dst0/p-tui";
import { formatHttpIdleTimeoutMs, HTTP_IDLE_TIMEOUT_CHOICES } from "../../../../core/http-dispatcher.ts";
import { keyDisplayText } from "../keybinding-hints.ts";
import { DEFAULT_PROJECT_TRUST_LABELS, THINKING_DESCRIPTIONS } from "./constants.ts";
import { createInterfaceSettingsItems } from "./interface-settings-items.ts";
import { SelectSubmenu } from "./selectsubmenu.ts";
import type { SettingsCallbacks, SettingsConfig } from "./types.ts";
import { WarningSettingsSubmenu } from "./warningsettingssubmenu.ts";

export function createSettingsItems(config: SettingsConfig, callbacks: SettingsCallbacks): SettingItem[] {
  let currentWarnings = { ...config.warnings };
  const followUpKey = keyDisplayText("app.message.followUp");

  return [
    ...(callbacks.onRunBudgetConfigure
      ? [
          {
            id: "run-budget",
            label: "Task budget",
            description: "Unlimited or a request, token, or estimated USD limit; preserves spend.",
            currentValue: config.runBudgetLabel ?? "configure",
            values: ["configure"],
          },
        ]
      : []),
    {
      id: "autocompact",
      label: "Auto-compact",
      description: "Automatically compact context when it gets too large",
      currentValue: config.autoCompact ? "true" : "false",
      values: ["true", "false"],
    },
    ...createInterfaceSettingsItems(config, Boolean(getCapabilities().images)),
    {
      id: "steering-mode",
      label: "Steering mode",
      description:
        "Enter while streaming queues steering messages. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.",
      currentValue: config.steeringMode,
      values: ["one-at-a-time", "all"],
    },
    {
      id: "follow-up-mode",
      label: "Follow-up mode",
      description: `${followUpKey} queues follow-up messages until agent stops. 'one-at-a-time': deliver one, wait for response. 'all': deliver all at once.`,
      currentValue: config.followUpMode,
      values: ["one-at-a-time", "all"],
    },
    {
      id: "transport",
      label: "Transport",
      description: "Preferred transport for providers that support multiple transports",
      currentValue: config.transport,
      values: ["sse", "websocket", "websocket-cached", "auto"],
    },
    {
      id: "http-idle-timeout",
      label: "HTTP idle timeout",
      description:
        "Maximum idle gap while waiting for HTTP headers or body chunks. Disable for local models that pause longer than five minutes.",
      currentValue: formatHttpIdleTimeoutMs(config.httpIdleTimeoutMs),
      values: HTTP_IDLE_TIMEOUT_CHOICES.map((choice) => choice.label),
    },
    {
      id: "hide-thinking",
      label: "Hide thinking",
      description: "Hide thinking blocks in assistant responses",
      currentValue: config.hideThinkingBlock ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "collapse-changelog",
      label: "Collapse changelog",
      description: "Show condensed changelog after updates",
      currentValue: config.collapseChangelog ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "quiet-startup",
      label: "Quiet startup",
      description: "Disable verbose printing at startup",
      currentValue: config.quietStartup ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "install-telemetry",
      label: "Install telemetry",
      description: "Send an anonymous version/update ping after changelog-detected updates",
      currentValue: config.enableInstallTelemetry ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "default-project-trust",
      label: "Default project trust",
      description: "Fallback behavior when no extension or saved trust decision decides project trust",
      currentValue: DEFAULT_PROJECT_TRUST_LABELS[config.defaultProjectTrust],
      values: Object.values(DEFAULT_PROJECT_TRUST_LABELS),
    },
    {
      id: "tool-result-extraction",
      label: "Tool result extraction",
      description: "Extract summaries from large tool results via a fast service model (adds latency)",
      currentValue: config.enableToolResultContextExtraction ? "true" : "false",
      values: ["true", "false"],
    },
    {
      id: "double-escape-action",
      label: "Double-escape action",
      description: "Action when pressing Escape twice with empty editor",
      currentValue: config.doubleEscapeAction,
      values: ["tree", "fork", "none"],
    },
    {
      id: "tree-filter-mode",
      label: "Tree filter mode",
      description: "Default filter when opening /tree",
      currentValue: config.treeFilterMode,
      values: ["default", "no-tools", "user-only", "labeled-only", "all"],
    },
    {
      id: "warnings",
      label: "Warnings",
      description: "Enable or disable individual warnings",
      currentValue: "configure",
      submenu: (_currentValue, done) =>
        new WarningSettingsSubmenu(
          currentWarnings,
          (warnings) => {
            currentWarnings = warnings;
            callbacks.onWarningsChange(warnings);
          },
          () => done(),
        ),
    },
    {
      id: "thinking",
      label: "Thinking level",
      description: "Reasoning depth for thinking-capable models",
      currentValue: config.thinkingLevel,
      submenu: (currentValue, done) =>
        new SelectSubmenu(
          "Thinking Level",
          "Select reasoning depth for thinking-capable models",
          config.availableThinkingLevels.map((level) => ({
            value: level,
            label: level,
            description: THINKING_DESCRIPTIONS[level],
          })),
          currentValue,
          (value) => {
            callbacks.onThinkingLevelChange(value as ThinkingLevel);
            done(value);
          },
          () => done(),
        ),
    },
    {
      id: "theme",
      label: "Theme",
      description: "Color theme for the interface",
      currentValue: config.currentTheme,
      submenu: (currentValue, done) =>
        new SelectSubmenu(
          "Theme",
          "Select color theme",
          config.availableThemes.map((theme) => ({ value: theme, label: theme })),
          currentValue,
          (value) => {
            callbacks.onThemeChange(value);
            done(value);
          },
          () => {
            callbacks.onThemePreview?.(currentValue);
            done();
          },
          (value) => callbacks.onThemePreview?.(value),
        ),
    },
  ];
}
