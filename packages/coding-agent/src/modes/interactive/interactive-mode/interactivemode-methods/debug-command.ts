import * as fs from "node:fs";
import * as path from "node:path";
import { Spacer, Text, visibleWidth } from "@dst0/p-tui";
import { getDebugLogPath } from "../../../../config.ts";
import type { CompactionDryRunResult } from "../../../../core/agent-session.ts";
import { formatTokenBreakdown } from "../../../../core/token-accounting.ts";
import type { TruncationResult } from "../../../../core/tools/truncate.ts";
import { ArminComponent } from "../../components/armin.ts";
import { BashExecutionComponent } from "../../components/bash-execution.ts";
import { DaxnutsComponent } from "../../components/daxnuts.ts";
import { EarendilAnnouncementComponent } from "../../components/earendil-announcement.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_handleDebugCommand(self: InteractiveMode): void {
  const width = self.ui.terminal.columns;
  const height = self.ui.terminal.rows;
  const allLines = self.ui.render(width);

  const debugLogPath = getDebugLogPath();
  const debugData = [
    `Debug output at ${new Date().toISOString()}`,
    `Terminal: ${width}x${height}`,
    `Total lines: ${allLines.length}`,
    "",
    "=== All rendered lines with visible widths ===",
    ...allLines.map((line, idx) => {
      const vw = visibleWidth(line);
      const escaped = JSON.stringify(line);
      return `[${idx}] (w=${vw}) ${escaped}`;
    }),
    "",
    "=== Agent messages (JSONL) ===",
    ...self.session.messages.map((msg) => JSON.stringify(msg)),
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(debugLogPath, debugData);

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(
    new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
  );
  self.ui.requestRender();
}

export function do_handleArminSaysHi(self: InteractiveMode): void {
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new ArminComponent(self.ui));
  self.ui.requestRender();
}

export function do_handleDementedDelves(self: InteractiveMode): void {
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new EarendilAnnouncementComponent());
  self.ui.requestRender();
}

export function do_handleDaxnuts(self: InteractiveMode): void {
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new DaxnutsComponent(self.ui));
  self.ui.requestRender();
}

export function do_checkDaxnutsEasterEgg(self: InteractiveMode, model: { provider: string; id: string }): void {
  if (model.provider === "opencode" && model.id.toLowerCase().includes("kimi-k2.5")) {
    self.handleDaxnuts();
  }
}

export async function do_handleBashCommand(
  self: InteractiveMode,
  command: string,
  excludeFromContext = false,
): Promise<void> {
  const extensionRunner = self.session.extensionRunner;

  // Emit user_bash event to let extensions intercept
  const eventResult = await extensionRunner.emitUserBash({
    type: "user_bash",
    command,
    excludeFromContext,
    cwd: self.sessionManager.getCwd(),
  });

  // If extension returned a full result, use it directly
  if (eventResult?.result) {
    const result = eventResult.result;

    // Create UI component for display
    self.bashComponent = new BashExecutionComponent(command, self.ui, excludeFromContext);
    if (self.session.isStreaming) {
      self.pendingMessagesContainer.addChild(self.bashComponent);
      self.pendingBashComponents.push(self.bashComponent);
    } else {
      self.chatContainer.addChild(self.bashComponent);
    }

    // Show output and complete
    if (result.output) {
      self.bashComponent.appendOutput(result.output);
    }
    self.bashComponent.setComplete(
      result.exitCode,
      result.cancelled,
      result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
      result.fullOutputPath,
    );

    // Record the result in session
    self.session.recordBashResult(command, result, { excludeFromContext });
    self.bashComponent = undefined;
    self.ui.requestRender();
    return;
  }

  // Normal execution path (possibly with custom operations)
  const isDeferred = self.session.isStreaming;
  self.bashComponent = new BashExecutionComponent(command, self.ui, excludeFromContext);

  if (isDeferred) {
    // Show in pending area when agent is streaming
    self.pendingMessagesContainer.addChild(self.bashComponent);
    self.pendingBashComponents.push(self.bashComponent);
  } else {
    // Show in chat immediately when agent is idle
    self.chatContainer.addChild(self.bashComponent);
  }
  self.ui.requestRender();

  try {
    const result = await self.session.executeBash(
      command,
      (chunk) => {
        if (self.bashComponent) {
          self.bashComponent.appendOutput(chunk);
          self.ui.requestRender();
        }
      },
      { excludeFromContext, operations: eventResult?.operations },
    );

    if (self.bashComponent) {
      self.bashComponent.setComplete(
        result.exitCode,
        result.cancelled,
        result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
        result.fullOutputPath,
      );
    }
  } catch (error) {
    if (self.bashComponent) {
      self.bashComponent.setComplete(undefined, false);
    }
    self.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  self.bashComponent = undefined;
  self.ui.requestRender();
}

export function do_formatCompactionDryRun(_self: InteractiveMode, result: CompactionDryRunResult): string {
  const status = result.ok ? "ready" : `skipped (${result.reason ?? "unknown"})`;
  const projected = result.projectedAfterTokens !== undefined ? `, projected ${result.projectedAfterTokens}` : "";
  const summarize = result.tokensToSummarize !== undefined ? `, summarize ${result.tokensToSummarize}` : "";
  const stubs = result.stubbedToolResults.length > 0 ? `, stubbed tools ${result.stubbedToolResults.length}` : "";
  const breakdown = result.tokenBreakdown ? `\n${formatTokenBreakdown(result.tokenBreakdown)}` : "";
  return `Compaction dry run: ${status}; context ${result.contextTokens}/${result.contextWindow}, trigger ${result.triggerThreshold}${summarize}${projected}, tool savings ${result.toolStubSavings}${stubs}${breakdown}`;
}
