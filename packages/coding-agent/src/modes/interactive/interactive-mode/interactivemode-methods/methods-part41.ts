import type { Keybinding } from "@dst0/p-tui";
import { Markdown, Spacer, Text } from "@dst0/p-tui";
import type { AppKeybinding } from "../../../../core/keybindings.ts";
import { getChangelogPath, normalizeChangelogLinks, parseChangelog } from "../../../../utils/changelog.ts";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { keyDisplayText } from "../../components/keybinding-hints.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

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
        : `Moved self repository to the top of the indexing queue: ${theme.fg("dim", resolvedPath)}\n` +
          "The background service is activating it now; progress will appear in the footer.\n")
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
    text += `Selected device: ${theme.bold(status.configuredDevice)}\n`;
  }
  if (status.configuredMaxBatchSize !== undefined) {
    text += `Configured max batch size: ${theme.bold(String(status.configuredMaxBatchSize))}\n`;
  }

  if (status.serviceRunning) {
    try {
      const res = await fetch("http://127.0.0.1:18742/health", { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const health = (await res.json()) as {
          device?: string;
          requestedBackend?: string;
          selectedBackend?: string;
          executionDevice?: string;
          gpuAllowed?: boolean;
          fallbackOccurred?: boolean;
          fallbackReason?: string;
          resource_plan?: { batch_size?: number };
          runtime?: { warnings?: string[] };
        };
        if (health.requestedBackend) {
          text += `Requested backend: ${theme.bold(health.requestedBackend)}\n`;
        }
        if (health.selectedBackend) {
          text += `Selected backend: ${theme.bold(health.selectedBackend)}\n`;
        }
        const deviceLabel = health.executionDevice ?? health.device;
        if (deviceLabel) {
          text += `Execution device: ${theme.bold(deviceLabel)}\n`;
        }
        if (health.gpuAllowed !== undefined) {
          text += `GPU allowed: ${health.gpuAllowed ? theme.fg("success", "yes") : theme.fg("warning", "no (GPU-deny policy)")}\n`;
        }
        if (health.fallbackOccurred) {
          text += `Fallback occurred: ${theme.fg("warning", "yes")} (${health.fallbackReason ?? "CPU fallback"})\n`;
        }
        if (health.resource_plan?.batch_size !== undefined) {
          text += `Current used batch size: ${theme.bold(String(health.resource_plan.batch_size))}\n`;
        }
        if (health.runtime?.warnings?.length) {
          text += `Embedding warnings: ${theme.fg("warning", health.runtime.warnings.join("; "))}\n`;
        }
      }
    } catch {
      // Embedding server status details optional if server is starting or idle
    }
  }

  if (status.ragState) {
    text += `Service state: ${status.ragState}\n`;
    if (status.ragFiles !== undefined) {
      const totalFiles = status.totalFiles ?? status.ragFiles;
      text += `Files indexed: ${status.ragFiles} out of ${totalFiles}\n`;
    }
    if (status.ragChunks !== undefined) {
      const totalChunks = status.totalChunks ?? status.ragChunks;
      text += `Chunks indexed: ${status.ragChunks} out of ${totalChunks}\n`;
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
