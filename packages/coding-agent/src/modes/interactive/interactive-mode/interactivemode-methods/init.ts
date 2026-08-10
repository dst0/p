import { Spacer, Text } from "@dst0/p-tui";
import { APP_NAME } from "../../../../config.ts";
import type { AppKeybinding } from "../../../../core/keybindings.ts";
import { ensureTool } from "../../../../utils/tools-manager.ts";
import { formatKeyText, keyHint, keyText, rawKeyHint } from "../../components/keybinding-hints.ts";
import { onThemeChange, theme } from "../../theme/theme.ts";
import { ExpandableText } from "../expandabletext.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_init(self: InteractiveMode): Promise<void> {
  if (self.isInitialized) return;

  self.registerSignalHandlers();

  // Load changelog (only show new entries, skip for resumed sessions)
  self.changelogMarkdown = self.getChangelogForDisplay();

  if (self.session.scopedModels.length > 0 && (self.options.verbose || !self.settingsManager.getQuietStartup())) {
    const modelList = self.session.scopedModels
      .map((sm) => {
        const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
        return `${sm.model.id}${thinkingStr}`;
      })
      .join(", ");
    const cycleKeys = self.keybindings.getKeys("app.model.cycleForward");
    const cycleHint =
      cycleKeys.length > 0
        ? theme.fg("muted", ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`)
        : "";
    console.log(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
  }

  // Add header container as first child. Populate it after detectThemeIfUnset.
  self.ui.addChild(self.headerContainer);

  self.ui.addChild(self.chatContainer);
  self.ui.addChild(self.pendingMessagesContainer);
  self.ui.addChild(self.statusContainer);
  self.renderWidgets(); // Initialize with default spacer
  self.ui.addChild(self.widgetContainerAbove);
  self.ui.addChild(self.editorContainer);
  self.ui.addChild(self.widgetContainerBelow);
  self.ui.addChild(self.footer);
  self.ui.setFocus(self.editor);

  self.setupKeyHandlers();
  self.setupEditorSubmitHandler();

  // Start the UI before initializing extensions so session_start handlers can use interactive dialogs
  self.ui.start();
  self.isInitialized = true;
  const toolSetupTimer = setTimeout(() => {
    if (self.shutdownRequested) return;
    void Promise.all([ensureTool("fd", true), ensureTool("rg", true)])
      .then(([fdPath]) => {
        if (self.shutdownRequested || fdPath === self.fdPath) return;
        self.fdPath = fdPath;
        self.setupAutocompleteProvider();
      })
      .catch((error) => {
        if (!self.shutdownRequested) {
          self.showError(
            `Failed to initialize search tools: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
  }, 0);
  toolSetupTimer.unref?.();

  await self.detectThemeIfUnset();

  // Add header with keybindings from config (unless silenced)
  if (self.options.verbose || !self.settingsManager.getQuietStartup()) {
    const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${self.version}`);

    // Build startup instructions using keybinding hint helpers
    const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

    const expandedInstructions = [
      hint("app.interrupt", "to interrupt"),
      hint("app.clear", "to clear"),
      rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
      hint("app.exit", "to exit (empty)"),
      hint("app.suspend", "to suspend"),
      keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
      hint("app.thinking.cycle", "to cycle thinking level"),
      rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
      hint("app.model.select", "to select model"),
      hint("app.tools.expand", "to expand tools"),
      hint("app.plan.toggle", "to toggle live plan"),
      hint("app.thinking.toggle", "to expand thinking"),
      hint("app.editor.external", "for external editor"),
      rawKeyHint("/", "for commands"),
      rawKeyHint("!", "to run bash"),
      rawKeyHint("!!", "to run bash (no context)"),
      hint("app.message.followUp", "to queue follow-up"),
      hint("app.message.dequeue", "to edit all queued messages"),
      hint("app.clipboard.pasteImage", "to paste image"),
      rawKeyHint("drop files", "to attach"),
    ].join("\n");
    const compactInstructions = [
      hint("app.interrupt", "interrupt"),
      rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
      rawKeyHint("/", "commands"),
      rawKeyHint("!", "bash"),
      hint("app.plan.toggle", "plan"),
      hint("app.tools.expand", "more"),
    ].join(theme.fg("muted", " · "));
    const compactOnboarding = theme.fg(
      "dim",
      `Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
    );
    const onboarding = theme.fg(
      "dim",
      `p can explain its own features and look up its docs. Ask it how to use or extend p.`,
    );
    self.builtInHeader = new ExpandableText(
      () => `${logo}\n${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
      () => `${logo}\n${expandedInstructions}\n\n${onboarding}`,
      self.getStartupExpansionState(),
      1,
      0,
    );

    // Setup UI layout
    self.headerContainer.addChild(new Spacer(1));
    self.headerContainer.addChild(self.builtInHeader);
    self.headerContainer.addChild(new Spacer(1));
  } else {
    // Minimal header when silenced
    self.builtInHeader = new Text("", 0, 0);
    self.headerContainer.addChild(self.builtInHeader);
  }
  self.ui.requestRender();

  // Initialize extensions first so resources are shown before messages
  await self.rebindCurrentSession();

  // Render initial messages AFTER showing loaded resources
  self.renderInitialMessages();

  // Set up theme file watcher
  onThemeChange(() => {
    self.updateTerminalBackground();
    self.ui.invalidate();
    self.updateEditorBorderColor();
    self.ui.requestRender();
  });

  // Set up git branch watcher (uses provider instead of footer)
  self.footerDataProvider.onBranchChange(() => {
    self.ui.requestRender();
  });

  // Set up progress watcher to update footer
  self.footerDataProvider.onProgressChange(() => {
    self.updateQueuedFooterSpinnerTimer();
    self.ui.requestRender();
  });
}
