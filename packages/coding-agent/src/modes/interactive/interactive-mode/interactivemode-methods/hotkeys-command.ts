import { Markdown, Spacer, Text } from "@dst0/p-tui";
import { DynamicBorder } from "../../components/dynamic-border.ts";
import { formatKeyText } from "../../components/keybinding-hints.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_handleHotkeysCommand(self: InteractiveMode): void {
  // Navigation keybindings
  const cursorUp = self.getEditorKeyDisplay("tui.editor.cursorUp");
  const cursorDown = self.getEditorKeyDisplay("tui.editor.cursorDown");
  const cursorLeft = self.getEditorKeyDisplay("tui.editor.cursorLeft");
  const cursorRight = self.getEditorKeyDisplay("tui.editor.cursorRight");
  const cursorWordLeft = self.getEditorKeyDisplay("tui.editor.cursorWordLeft");
  const cursorWordRight = self.getEditorKeyDisplay("tui.editor.cursorWordRight");
  const cursorLineStart = self.getEditorKeyDisplay("tui.editor.cursorLineStart");
  const cursorLineEnd = self.getEditorKeyDisplay("tui.editor.cursorLineEnd");
  const jumpForward = self.getEditorKeyDisplay("tui.editor.jumpForward");
  const jumpBackward = self.getEditorKeyDisplay("tui.editor.jumpBackward");
  const pageUp = self.getEditorKeyDisplay("tui.editor.pageUp");
  const pageDown = self.getEditorKeyDisplay("tui.editor.pageDown");

  // Editing keybindings
  const submit = self.getEditorKeyDisplay("tui.input.submit");
  const newLine = self.getEditorKeyDisplay("tui.input.newLine");
  const deleteWordBackward = self.getEditorKeyDisplay("tui.editor.deleteWordBackward");
  const deleteWordForward = self.getEditorKeyDisplay("tui.editor.deleteWordForward");
  const deleteToLineStart = self.getEditorKeyDisplay("tui.editor.deleteToLineStart");
  const deleteToLineEnd = self.getEditorKeyDisplay("tui.editor.deleteToLineEnd");
  const yank = self.getEditorKeyDisplay("tui.editor.yank");
  const yankPop = self.getEditorKeyDisplay("tui.editor.yankPop");
  const undo = self.getEditorKeyDisplay("tui.editor.undo");
  const tab = self.getEditorKeyDisplay("tui.input.tab");

  // App keybindings
  const interrupt = self.getAppKeyDisplay("app.interrupt");
  const clear = self.getAppKeyDisplay("app.clear");
  const exit = self.getAppKeyDisplay("app.exit");
  const suspend = self.getAppKeyDisplay("app.suspend");
  const cycleThinkingLevel = self.getAppKeyDisplay("app.thinking.cycle");
  const cycleModelForward = self.getAppKeyDisplay("app.model.cycleForward");
  const selectModel = self.getAppKeyDisplay("app.model.select");
  const expandTools = self.getAppKeyDisplay("app.tools.expand");
  const toggleThinking = self.getAppKeyDisplay("app.thinking.toggle");
  const externalEditor = self.getAppKeyDisplay("app.editor.external");
  const cycleModelBackward = self.getAppKeyDisplay("app.model.cycleBackward");
  const followUp = self.getAppKeyDisplay("app.message.followUp");
  const dequeue = self.getAppKeyDisplay("app.message.dequeue");
  const pasteImage = self.getAppKeyDisplay("app.clipboard.pasteImage");

  let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste image from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

  // Add extension-registered shortcuts
  const extensionRunner = self.session.extensionRunner;
  const shortcuts = extensionRunner.getShortcuts(self.keybindings.getEffectiveConfig());
  if (shortcuts.size > 0) {
    hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
    for (const [key, shortcut] of shortcuts) {
      const description = shortcut.description ?? shortcut.extensionPath;
      const keyDisplay = formatKeyText(key, { capitalize: true });
      hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
    }
  }

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new DynamicBorder());
  self.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, self.getMarkdownThemeWithSettings()));
  self.chatContainer.addChild(new DynamicBorder());
  self.ui.requestRender();
}

export async function do_handleClearCommand(self: InteractiveMode): Promise<void> {
  if (self.loadingAnimation) {
    self.loadingAnimation.stop();
    self.loadingAnimation = undefined;
  }
  self.statusContainer.clear();
  try {
    const result = await self.runtimeHost.newSession();
    if (result.cancelled) {
      return;
    }
    self.renderCurrentSessionState();
    self.chatContainer.addChild(new Spacer(1));
    self.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
    self.ui.requestRender();
  } catch (error: unknown) {
    await self.handleFatalRuntimeError("Failed to create session", error);
  }
}
