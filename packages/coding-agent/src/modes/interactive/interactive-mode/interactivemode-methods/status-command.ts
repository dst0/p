import type { Keybinding } from "@dst0/p-tui";
import { Markdown, Spacer, Text } from "@dst0/p-tui";
import type { AppKeybinding } from "../../../../core/keybindings.ts";
import { getChangelogPath, normalizeChangelogLinks, parseChangelog } from "../../../../utils/changelog.ts";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { keyDisplayText } from "../../components/keybinding-hints.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";
import { formatIndexHealth, type IndexHealth } from "./index-health-format.ts";

export async function do_buildIndexStatusText(
  self: InteractiveMode,
  resolvedPath: string,
  args: string,
): Promise<string> {
  if (args === "enable") {
    self.indexingService.enableIndexing(resolvedPath);
    return (
      `${theme.bold("Code Indexing")}\n\n` +
      `Indexing ${theme.fg("success", "enabled")} for ${theme.fg("dim", resolvedPath)}\n` +
      "The background service will start indexing it. Check status with /index.\n"
    );
  }
  if (args === "disable") {
    self.indexingService.disableIndexing(resolvedPath);
    return (
      `${theme.bold("Code Indexing")}\n\n` +
      `Indexing ${theme.fg("error", "disabled")} for ${theme.fg("dim", resolvedPath)}\n`
    );
  }
  if (args === "up") {
    const status = self.indexingService.getStatus(resolvedPath);
    if (!self.indexingService.prioritizeIndexing(resolvedPath)) {
      return (
        `${theme.bold("Code Indexing")}\n\n` +
        `Indexing is not enabled for ${theme.fg("dim", resolvedPath)}. Run /index enable first.\n`
      );
    }
    const alreadyActive = status.ragState === "initializing" || status.ragState === "updating";
    return (
      `${theme.bold("Code Indexing")}\n\n` +
      (alreadyActive
        ? `This repository is already actively indexing: ${theme.fg("dim", resolvedPath)}\n`
        : `Prioritized this repository: ${theme.fg("dim", resolvedPath)}\n` +
          "The active indexing job will stop, release the embedding device, and return to the queue.\n")
    );
  }
  if (args) return `Usage: ${theme.fg("dim", "/index | /index enable | /index disable | /index up")}`;

  const status = self.indexingService.getStatus(resolvedPath);
  let text = `${theme.bold("Code Indexing")}\n\n`;
  text += `Repository: ${theme.fg("dim", resolvedPath)}\n`;
  const decision =
    status.decision === "enabled"
      ? theme.fg("success", "enabled")
      : status.decision === "disabled"
        ? theme.fg("error", "disabled")
        : theme.fg("warning", "not configured");
  text += `Indexing: ${decision}\n`;
  text += `Background service: ${status.serviceRunning ? theme.fg("success", "running") : theme.fg("error", "not running")}\n`;
  if (status.configuredDevice) {
    const configuredDevice =
      status.configuredDevice === "mps" || status.configuredDevice === "apple-mps"
        ? "GPU (MPS)"
        : status.configuredDevice === "apple-ane"
          ? "NPU (Apple Neural Engine)"
          : status.configuredDevice;
    text += `Selected device: ${theme.bold(configuredDevice)}\n`;
  }
  if (status.configuredMaxBatchSize !== undefined) {
    text += `Configured max batch size: ${theme.bold(String(status.configuredMaxBatchSize))}\n`;
  }

  if (status.serviceRunning) {
    try {
      const res = await fetch("http://127.0.0.1:18742/health", { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        text += formatIndexHealth((await res.json()) as IndexHealth);
      }
    } catch {
      // Embedding server status details optional if server is starting or idle
    }
  }

  if (status.ragState) {
    const phase = status.progress?.phase;
    text += `Service state: ${phase === "indexing" ? "embedding" : (phase ?? status.ragState)}\n`;
    if (status.progress?.totalFiles !== undefined) {
      const label = phase === "scanning" ? "Files scanned" : "Files prepared";
      text += `${label}: ${status.progress.processedFiles ?? 0} out of ${status.progress.totalFiles}\n`;
    } else if (status.ragState === "ready" && status.ragFiles !== undefined) {
      text += `Files indexed: ${status.ragFiles}\n`;
    }
    if (status.progress?.totalChunks !== undefined) {
      text += `Chunks indexed: ${status.progress.processedChunks ?? 0} out of ${status.progress.totalChunks}\n`;
    } else if (status.ragState === "ready" && status.ragChunks !== undefined) {
      text += `Chunks indexed: ${status.ragChunks}\n`;
    }
  }
  if (status.lastError) text += `Last error: ${status.lastError}\n`;

  text += `\nUsage: ${theme.fg("dim", "/index | /index enable | /index disable | /index up")}`;

  return text;
}

export function do_handleChangelogCommand(self: InteractiveMode): void {
  const changelogPath = getChangelogPath();
  const allEntries = parseChangelog(changelogPath);

  const changelogMarkdown =
    allEntries.length > 0
      ? allEntries
          .reverse()
          .map((e) => normalizeChangelogLinks(e.content, e))
          .join("\n\n")
      : "No changelog entries found.";

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new DynamicBorder());
  self.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, self.getMarkdownThemeWithSettings()));
  self.chatContainer.addChild(new DynamicBorder());
  self.ui.requestRender();
}

export function do_getAppKeyDisplay(_self: InteractiveMode, action: AppKeybinding): string {
  return keyDisplayText(action);
}

export function do_getEditorKeyDisplay(_self: InteractiveMode, action: Keybinding): string {
  return keyDisplayText(action);
}
