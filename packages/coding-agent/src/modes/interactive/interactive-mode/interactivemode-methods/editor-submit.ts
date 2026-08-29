import type { InteractiveMode } from "../interactivemode.ts";

export function do_setupEditorSubmitHandler(self: InteractiveMode): void {
  self.defaultEditor.onSubmit = async (text: string) => {
    text = text.trim();
    if (!text) return;

    if (text.startsWith("/")) {
      self.editor.addToHistory?.(text);
    }

    // Handle commands
    if (text === "/settings") {
      self.showSettingsSelector();
      self.editor.setText("");
      return;
    }
    if (text === "/plan" || text.startsWith("/plan ")) {
      self.editor.setText("");
      await self.handlePlanCommand(text);
      return;
    }
    if (text === "/scoped-models") {
      self.editor.setText("");
      await self.showModelsSelector();
      return;
    }
    if (
      text === "/model:image" ||
      text.startsWith("/model:image ") ||
      text === "/image-model" ||
      text.startsWith("/image-model ")
    ) {
      const prefix = text.startsWith("/model:image") ? "/model:image" : "/image-model";
      const searchTerm = text.startsWith(`${prefix} `) ? text.slice(prefix.length + 1).trim() : undefined;
      self.editor.setText("");
      await self.handleImageModelCommand(searchTerm);
      return;
    }
    if (text === "/model" || text.startsWith("/model ")) {
      const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
      self.editor.setText("");
      await self.handleModelCommand(searchTerm);
      return;
    }
    if (text === "/export" || text.startsWith("/export ")) {
      await self.handleExportCommand(text);
      self.editor.setText("");
      return;
    }
    if (text === "/import" || text.startsWith("/import ")) {
      await self.handleImportCommand(text);
      self.editor.setText("");
      return;
    }
    if (text === "/share") {
      await self.handleShareCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/copy") {
      await self.handleCopyCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/name" || text.startsWith("/name ")) {
      self.handleNameCommand(text);
      self.editor.setText("");
      return;
    }
    if (text === "/session") {
      self.handleSessionCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/changelog") {
      self.handleChangelogCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/hotkeys") {
      self.handleHotkeysCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/fork") {
      self.showUserMessageSelector();
      self.editor.setText("");
      return;
    }
    if (text === "/clone") {
      self.editor.setText("");
      await self.handleCloneCommand();
      return;
    }
    if (text === "/tree") {
      self.showTreeSelector();
      self.editor.setText("");
      return;
    }
    if (text === "/trust") {
      self.showTrustSelector();
      self.editor.setText("");
      return;
    }
    if (text === "/login") {
      self.showOAuthSelector("login");
      self.editor.setText("");
      return;
    }
    if (text === "/logout") {
      self.showOAuthSelector("logout");
      self.editor.setText("");
      return;
    }
    if (text === "/new") {
      self.editor.setText("");
      await self.handleClearCommand();
      return;
    }
    if (text === "/compact" || text.startsWith("/compact ")) {
      const rawArgs = text.startsWith("/compact ") ? text.slice(9).trim() : "";
      const dryRun = rawArgs.split(/\s+/).includes("--dry-run");
      const audit = rawArgs.split(/\s+/).includes("--audit");
      const customInstructions = rawArgs.replace(/(?:^|\s)--(?:dry-run|audit)(?=\s|$)/g, " ").trim() || undefined;
      self.editor.setText("");
      await self.handleCompactCommand(customInstructions, { dryRun, audit });
      return;
    }
    if (text === "/state") {
      self.handleStateCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/memory" || text.startsWith("/memory ")) {
      self.handleMemoryCommand(text);
      self.editor.setText("");
      return;
    }
    if (text === "/rules" || text.startsWith("/rules ")) {
      self.handleRulesCommand(text);
      self.editor.setText("");
      return;
    }
    if (text === "/reload") {
      self.editor.setText("");
      await self.handleReloadCommand();
      return;
    }
    if (text === "/index" || text.startsWith("/index ")) {
      self.editor.setText("");
      await self.handleIndexCommand(text);
      return;
    }
    if (text === "/debug") {
      self.handleDebugCommand();
      self.editor.setText("");
      return;
    }
    if (text === "/arminsayshi") {
      self.handleArminSaysHi();
      self.editor.setText("");
      return;
    }
    if (text === "/dementedelves") {
      self.handleDementedDelves();
      self.editor.setText("");
      return;
    }
    if (text === "/resume") {
      self.showSessionSelector();
      self.editor.setText("");
      return;
    }
    if (text === "/quit") {
      self.editor.setText("");
      await self.shutdown();
      return;
    }

    // Handle bash command (! for normal, !! for excluded from context)
    if (text.startsWith("!")) {
      const isExcluded = text.startsWith("!!");
      const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
      if (command) {
        if (self.session.isBashRunning) {
          self.showWarning("A bash command is already running. Press Esc to cancel it first.");
          self.editor.setText(text);
          return;
        }
        self.editor.addToHistory?.(text);
        await self.handleBashCommand(command, isExcluded);
        self.isBashMode = false;
        self.updateEditorBorderColor();
        return;
      }
    }

    // Queue input during compaction (extension commands execute immediately)
    if (self.session.isCompacting) {
      if (self.isExtensionCommand(text)) {
        self.editor.addToHistory?.(text);
        self.editor.setText("");
        await self.session.prompt(text);
      } else {
        self.queueCompactionMessage(text, "steer");
      }
      return;
    }

    // If streaming, use prompt() with steer behavior
    // This handles extension commands (execute immediately), prompt template expansion, and queueing
    if (self.session.isStreaming) {
      self.editor.addToHistory?.(text);
      self.editor.setText("");
      await self.session.prompt(text, { streamingBehavior: "steer" });
      self.updatePendingMessagesDisplay();
      self.ui.requestRender();
      return;
    }

    // Normal message submission
    // First, move any pending bash components to chat
    self.flushPendingBashComponents();

    if (self.onInputCallback) {
      self.onInputCallback(text);
    } else {
      self.pendingUserInputs.push(text);
    }
    self.editor.addToHistory?.(text);
  };
}
