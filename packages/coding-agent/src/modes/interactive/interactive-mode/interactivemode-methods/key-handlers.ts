import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { extensionForImageMimeType, readClipboardImage } from "../../../../utils/clipboard-image.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_setupKeyHandlers(self: InteractiveMode): void {
  // Set up handlers on defaultEditor - they use self.editor for text access
  // so they work correctly regardless of which editor is active
  self.defaultEditor.onEscape = () => {
    if (self.session.isStreaming) {
      self.restoreQueuedMessagesToEditor({ abort: true });
    } else if (self.session.isBashRunning) {
      self.session.abortBash();
    } else if (self.isBashMode) {
      self.editor.setText("");
      self.isBashMode = false;
      self.updateEditorBorderColor();
    } else if (!self.editor.getText().trim()) {
      // Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
      const action = self.settingsManager.getDoubleEscapeAction();
      if (action !== "none") {
        const now = Date.now();
        if (now - self.lastEscapeTime < 500) {
          if (action === "tree") {
            self.showTreeSelector();
          } else {
            self.showUserMessageSelector();
          }
          self.lastEscapeTime = 0;
        } else {
          self.lastEscapeTime = now;
        }
      }
    }
  };

  // Register app action handlers
  self.defaultEditor.onAction("app.clear", () => self.handleCtrlC());
  self.defaultEditor.onCtrlD = () => self.handleCtrlD();
  self.defaultEditor.onAction("app.suspend", () => self.handleCtrlZ());
  self.defaultEditor.onAction("app.thinking.cycle", () => self.cycleThinkingLevel());
  self.defaultEditor.onAction("app.model.cycleForward", () => self.cycleModel("forward"));
  self.defaultEditor.onAction("app.model.cycleBackward", () => self.cycleModel("backward"));

  // Global debug handler on TUI (works regardless of focus)
  self.ui.onDebug = () => self.handleDebugCommand();
  self.defaultEditor.onAction("app.model.select", () => self.showModelSelector());
  self.defaultEditor.onAction("app.tools.expand", () => self.toggleToolOutputExpansion());
  self.defaultEditor.onAction("app.thinking.toggle", () => self.toggleThinkingBlockVisibility());
  self.defaultEditor.onAction("app.editor.external", () => self.openExternalEditor());
  self.defaultEditor.onAction("app.message.followUp", () => self.handleFollowUp());
  self.defaultEditor.onAction("app.message.dequeue", () => self.handleDequeue());
  self.defaultEditor.onAction("app.session.new", () => self.handleClearCommand());
  self.defaultEditor.onAction("app.session.tree", () => self.showTreeSelector());
  self.defaultEditor.onAction("app.session.fork", () => self.showUserMessageSelector());
  self.defaultEditor.onAction("app.session.resume", () => self.showSessionSelector());

  self.defaultEditor.onAction("app.plan.toggle", () => self.togglePlanPanel());
  self.defaultEditor.onChange = (text: string) => {
    const wasBashMode = self.isBashMode;
    self.isBashMode = text.trimStart().startsWith("!");
    if (wasBashMode !== self.isBashMode) {
      self.updateEditorBorderColor();
    }
  };

  // Handle clipboard image paste (triggered on Ctrl+V)
  self.defaultEditor.onPasteImage = () => {
    self.handleClipboardImagePaste();
  };
}

export async function do_handleClipboardImagePaste(self: InteractiveMode): Promise<void> {
  try {
    const image = await readClipboardImage();
    if (!image) {
      return;
    }

    // Write to temp file
    const tmpDir = os.tmpdir();
    const ext = extensionForImageMimeType(image.mimeType) ?? "png";
    const fileName = `p-clipboard-${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(image.bytes));

    // Insert file path directly
    self.editor.insertTextAtCursor?.(filePath);
    self.ui.requestRender();
  } catch {
    // Silently ignore clipboard errors (may not have permission, etc.)
  }
}
