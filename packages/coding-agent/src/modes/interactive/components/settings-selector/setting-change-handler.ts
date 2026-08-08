import type { Transport } from "@dst0/p-ai";
import { HTTP_IDLE_TIMEOUT_CHOICES } from "../../../../core/http-dispatcher.ts";
import { DEFAULT_PROJECT_TRUST_BY_LABEL } from "./constants.ts";
import type { SettingsCallbacks } from "./types.ts";

export function createSettingChangeHandler(callbacks: SettingsCallbacks): (id: string, newValue: string) => void {
  return (id, newValue) => {
    switch (id) {
      case "autocompact":
        callbacks.onAutoCompactChange(newValue === "true");
        break;
      case "show-images":
        callbacks.onShowImagesChange(newValue === "true");
        break;
      case "image-width-cells":
        callbacks.onImageWidthCellsChange(Number.parseInt(newValue, 10));
        break;
      case "auto-resize-images":
        callbacks.onAutoResizeImagesChange(newValue === "true");
        break;
      case "block-images":
        callbacks.onBlockImagesChange(newValue === "true");
        break;
      case "skill-commands":
        callbacks.onEnableSkillCommandsChange(newValue === "true");
        break;
      case "steering-mode":
        callbacks.onSteeringModeChange(newValue as "all" | "one-at-a-time");
        break;
      case "follow-up-mode":
        callbacks.onFollowUpModeChange(newValue as "all" | "one-at-a-time");
        break;
      case "transport":
        callbacks.onTransportChange(newValue as Transport);
        break;
      case "http-idle-timeout": {
        const choice = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.label === newValue);
        if (choice) callbacks.onHttpIdleTimeoutMsChange(choice.timeoutMs);
        break;
      }
      case "hide-thinking":
        callbacks.onHideThinkingBlockChange(newValue === "true");
        break;
      case "collapse-changelog":
        callbacks.onCollapseChangelogChange(newValue === "true");
        break;
      case "quiet-startup":
        callbacks.onQuietStartupChange(newValue === "true");
        break;
      case "install-telemetry":
        callbacks.onEnableInstallTelemetryChange(newValue === "true");
        break;
      case "default-project-trust": {
        const defaultProjectTrust = DEFAULT_PROJECT_TRUST_BY_LABEL.get(newValue);
        if (defaultProjectTrust) callbacks.onDefaultProjectTrustChange(defaultProjectTrust);
        break;
      }
      case "tool-result-extraction":
        callbacks.onEnableToolResultContextExtractionChange(newValue === "true");
        break;
      case "double-escape-action":
        callbacks.onDoubleEscapeActionChange(newValue as "fork" | "tree");
        break;
      case "tree-filter-mode":
        callbacks.onTreeFilterModeChange(newValue as "default" | "no-tools" | "user-only" | "labeled-only" | "all");
        break;
      case "show-hardware-cursor":
        callbacks.onShowHardwareCursorChange(newValue === "true");
        break;
      case "editor-padding":
        callbacks.onEditorPaddingXChange(Number.parseInt(newValue, 10));
        break;
      case "autocomplete-max-visible":
        callbacks.onAutocompleteMaxVisibleChange(Number.parseInt(newValue, 10));
        break;
      case "clear-on-shrink":
        callbacks.onClearOnShrinkChange(newValue === "true");
        break;
      case "terminal-progress":
        callbacks.onShowTerminalProgressChange(newValue === "true");
        break;
      case "token-progress":
        callbacks.onShowTokenProgressChange(newValue === "true");
        break;
      case "token-stats":
        callbacks.onShowTokenStatsChange(newValue === "true");
        break;
      case "indexing-info":
        callbacks.onShowIndexingInfoChange(newValue === "true");
        break;
      case "version":
        callbacks.onShowVersionChange(newValue === "true");
        break;
      case "harness-messages":
        callbacks.onShowHarnessMessagesChange(newValue === "true");
        break;
    }
  };
}
