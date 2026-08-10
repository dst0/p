import { Loader, Spacer } from "@dst0/p-tui";
import { keyText } from "../../components/keybinding-hints.ts";
import { TreeSelectorComponent } from "../../components/tree-selector.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showTreeSelector(self: InteractiveMode, initialSelectedId?: string): void {
  const tree = self.sessionManager.getTree();
  const realLeafId = self.sessionManager.getLeafId();
  const initialFilterMode = self.settingsManager.getTreeFilterMode();

  if (tree.length === 0) {
    self.showStatus("No entries in session");
    return;
  }

  self.showSelector((done) => {
    const selector = new TreeSelectorComponent(
      tree,
      realLeafId,
      self.ui.terminal.rows,
      async (entryId) => {
        // Selecting the current leaf is a no-op (already there)
        if (entryId === realLeafId) {
          done();
          self.showStatus("Already at this point");
          return;
        }

        // Ask about summarization
        done(); // Close selector first

        // Loop until user makes a complete choice or cancels to tree
        let wantsSummary = false;
        let customInstructions: string | undefined;

        // Check if we should skip the prompt (user preference to always default to no summary)
        if (!self.settingsManager.getBranchSummarySkipPrompt()) {
          while (true) {
            const summaryChoice = await self.showExtensionSelector("Summarize branch?", [
              "No summary",
              "Summarize",
              "Summarize with custom prompt",
            ]);

            if (summaryChoice === undefined) {
              // User pressed escape - re-show tree selector with same selection
              self.showTreeSelector(entryId);
              return;
            }

            wantsSummary = summaryChoice !== "No summary";

            if (summaryChoice === "Summarize with custom prompt") {
              customInstructions = await self.showExtensionEditor("Custom summarization instructions");
              if (customInstructions === undefined) {
                // User cancelled - loop back to summary selector
                continue;
              }
            }

            // User made a complete choice
            break;
          }
        }

        // Set up escape handler and loader if summarizing
        let summaryLoader: Loader | undefined;
        const originalOnEscape = self.defaultEditor.onEscape;

        if (wantsSummary) {
          self.defaultEditor.onEscape = () => {
            self.session.abortBranchSummary();
          };
          self.chatContainer.addChild(new Spacer(1));
          summaryLoader = new Loader(
            self.ui,
            (spinner) => theme.fg("accent", spinner),
            (text) => theme.fg("muted", text),
            `Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
          );
          self.statusContainer.addChild(summaryLoader);
          self.ui.requestRender();
        }

        try {
          const result = await self.session.navigateTree(entryId, {
            summarize: wantsSummary,
            customInstructions,
          });

          if (result.aborted) {
            // Summarization aborted - re-show tree selector with same selection
            self.showStatus("Branch summarization cancelled");
            self.showTreeSelector(entryId);
            return;
          }
          if (result.cancelled) {
            self.showStatus("Navigation cancelled");
            return;
          }

          // Update UI
          self.chatContainer.clear();
          self.renderInitialMessages();
          if (result.editorText && !self.editor.getText().trim()) {
            self.editor.setText(result.editorText);
          }
          self.showStatus("Navigated to selected point");
          void self.flushCompactionQueue({ willRetry: false });
        } catch (error) {
          self.showError(error instanceof Error ? error.message : String(error));
        } finally {
          if (summaryLoader) {
            summaryLoader.stop();
            self.statusContainer.clear();
          }
          self.defaultEditor.onEscape = originalOnEscape;
        }
      },
      () => {
        done();
        self.ui.requestRender();
      },
      (entryId, label) => {
        self.sessionManager.appendLabelChange(entryId, label);
        self.ui.requestRender();
      },
      initialSelectedId,
      initialFilterMode,
    );
    return { component: selector, focus: selector };
  });
}
