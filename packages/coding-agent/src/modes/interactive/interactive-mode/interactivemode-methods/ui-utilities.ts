import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCapabilities, hyperlink, Markdown, Spacer, Text } from "@dst0/p-tui";
import { spawn } from "child_process";
import { APP_NAME } from "../../../../config.ts";
import type { AgentSessionEvent } from "../../../../core/agent-session.ts";
import type { LatestPiRelease } from "../../../../utils/version-check.ts";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_removeTransientStreamingUi(self: InteractiveMode): void {
  if (self.streamingComponent) {
    self.chatContainer.removeChild(self.streamingComponent);
    self.streamingComponent = undefined;
    self.streamingMessage = undefined;
  }
  for (const [, component] of self.pendingTools.entries()) {
    self.chatContainer.removeChild(component);
  }
  self.pendingTools.clear();
}

export function do_showRetryProgressInFooter(
  self: InteractiveMode,
  event: Extract<AgentSessionEvent, { type: "auto_retry_start" }>,
): void {
  const recentSwitch = self.getRecentModelSwitch();
  self.footerDataProvider.setPrefillProgress(undefined);
  self.footerDataProvider.setGenProgress(undefined);
  self.footerDataProvider.setSendingProgress(undefined);
  self.clearLlmOrchestratorQueueProgress();
  if (recentSwitch) {
    self.footerDataProvider.setModelSwitchProgress(recentSwitch);
  }
  if (event.reason === "model_loading" || recentSwitch) {
    self.footerDataProvider.setLoadingProgress({
      model:
        recentSwitch?.toModel ?? (self.session.model ? self.getModelStatusLabel(self.session.model) : "current model"),
    });
  }
}

export function do_toggleThinkingBlockVisibility(self: InteractiveMode): void {
  self.hideThinkingBlock = !self.hideThinkingBlock;
  self.settingsManager.setHideThinkingBlock(self.hideThinkingBlock);

  // Rebuild chat from session messages
  self.chatContainer.clear();
  self.rebuildChatFromMessages();

  // If streaming, re-add the streaming component with updated visibility and re-render
  if (self.streamingComponent && self.streamingMessage) {
    self.streamingComponent.setHideThinkingBlock(self.hideThinkingBlock);
    self.streamingComponent.updateContent(self.streamingMessage);
    self.chatContainer.addChild(self.streamingComponent);
  }

  self.showStatus(`Thinking blocks: ${self.hideThinkingBlock ? "hidden" : "visible"}`);
}

export async function do_openExternalEditor(self: InteractiveMode): Promise<void> {
  // Determine editor (respect $VISUAL, then $EDITOR)
  const editorCmd = process.env.VISUAL || process.env.EDITOR;
  if (!editorCmd) {
    self.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
    return;
  }

  const currentText = self.editor.getExpandedText?.() ?? self.editor.getText();
  const tmpFile = path.join(os.tmpdir(), `p-editor-${Date.now()}.p.md`);

  try {
    // Write current content to temp file
    fs.writeFileSync(tmpFile, currentText, "utf-8");

    // Stop TUI to release terminal
    self.ui.stop();

    // Split by space to support editor arguments (e.g., "code --wait")
    const [editor, ...editorArgs] = editorCmd.split(" ");

    process.stdout.write(`Launching external editor: ${editorCmd}\nPi will resume when the editor exits.\n`);

    // Do not use spawnSync here. On Windows, synchronous child_process calls can keep
    // Node/libuv's console input read active after ui.stop() pauses stdin, racing
    // vim/nvim for the console input buffer until Ctrl+C cancels the pending read.
    const status = await new Promise<number | null>((resolve) => {
      const child = spawn(editor, [...editorArgs, tmpFile], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code));
    });

    // On successful exit (status 0), replace editor content
    if (status === 0) {
      const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
      self.editor.setText(newContent);
    }
    // On non-zero exit, keep original text (no action needed)
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }

    // Restart TUI
    self.ui.start();
    // Force full re-render since external editor uses alternate screen
    self.ui.requestRender(true);
  }
}

export function do_clearEditor(self: InteractiveMode): void {
  self.editor.setText("");
  self.ui.requestRender();
}

export function do_showError(self: InteractiveMode, errorMessage: string): void {
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
  self.chatContainer.addChild(new Spacer(1));
  self.ui.requestRender();
}

export function do_showWarning(self: InteractiveMode, warningMessage: string): void {
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
  self.ui.requestRender();
}

export function do_showNewVersionNotification(self: InteractiveMode, release: LatestPiRelease): void {
  const action = theme.fg("accent", `${APP_NAME} update`);
  const updateInstruction = theme.fg("muted", `New version ${release.version} is available. Run `) + action;
  const changelogUrl = "https://p.dev/changelog";
  const changelogLink = getCapabilities().hyperlinks
    ? hyperlink(theme.fg("accent", "open changelog"), changelogUrl)
    : theme.fg("accent", changelogUrl);
  const changelogLine = theme.fg("muted", "Changelog: ") + changelogLink;
  const note = release.note?.trim();

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
  self.chatContainer.addChild(
    new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}`, 1, 0),
  );
  if (note) {
    self.chatContainer.addChild(new Spacer(1));
    self.chatContainer.addChild(
      new Markdown(note, 1, 0, self.getMarkdownThemeWithSettings(), {
        color: (text) => theme.fg("muted", text),
      }),
    );
    self.chatContainer.addChild(new Spacer(1));
  }
  self.chatContainer.addChild(new Text(changelogLine, 1, 0));
  self.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
  self.ui.requestRender();
}
