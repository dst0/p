import { chooseRunBudget, type RunBudgetChoiceUI } from "../../../../cli/run-budget-choice.ts";
import type { AgentSession } from "../../../../core/agent-session.ts";
import { formatRunBudget } from "../../../../core/run-budget/presentation.ts";
import { parseRunBudgetArgument } from "../../../../core/run-budget-policy.ts";
import type { SettingsManager } from "../../../../core/settings-manager.ts";

interface BudgetCommandContext {
  session: Pick<AgentSession, "runBudget" | "isStreaming" | "isCompacting" | "isRetrying">;
  settingsManager: Pick<SettingsManager, "setRunBudgetPolicy">;
  createExtensionUIContext(): RunBudgetChoiceUI;
  showStatus(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  footer: { invalidate(): void };
  ui: { requestRender(): void };
}

export async function handleBudgetCommand(self: BudgetCommandContext, text: string): Promise<void> {
  try {
    self.showStatus(formatRunBudget(self.session.runBudget.snapshot()));
    const argument = text.replace(/^\/budget\s*/, "").trim();
    if (argument === "status") return;
    if (self.session.isStreaming || self.session.isCompacting || self.session.isRetrying) {
      self.showWarning("Stop active work before changing the budget. No queued work will be resumed automatically.");
      return;
    }
    const policy = argument ? parseRunBudgetArgument(argument) : await chooseRunBudget(self.createExtensionUIContext());
    if (!policy) return;
    await self.settingsManager.setRunBudgetPolicy(policy);
    try {
      self.session.runBudget.setPolicy(policy);
    } catch (error) {
      self.showError(
        `Default saved, but the active task budget could not be changed: ${error instanceof Error ? error.message : "storage failure"}`,
      );
      return;
    }
    self.showStatus(
      `${formatRunBudget(self.session.runBudget.snapshot())}\nSaved as default. Spend retained; work has not resumed.`,
    );
    self.footer.invalidate();
    self.ui.requestRender();
  } catch (error) {
    self.showError(error instanceof Error ? error.message : "Could not change task budget");
  }
}
