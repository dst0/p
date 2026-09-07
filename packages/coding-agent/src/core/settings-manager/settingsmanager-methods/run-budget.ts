import { type RunBudgetPolicy, validateRunBudgetPolicy } from "../../run-budget-policy.ts";
import { SettingsManager } from "../settingsmanager.ts";

export function do_getRunBudgetPolicy(self: SettingsManager): RunBudgetPolicy | undefined {
  if (self.globalSettingsLoadError) throw new Error("Cannot read run budget: global settings failed to load");
  const policy = self.globalSettings.runBudget;
  return policy === undefined ? undefined : validateRunBudgetPolicy(policy);
}

/** Authorize only a checked global write; the generic settings queue records errors without rejecting. */
export async function do_setRunBudgetPolicy(self: SettingsManager, value: RunBudgetPolicy): Promise<void> {
  const policy = validateRunBudgetPolicy(value);
  const previous = self.globalSettings.runBudget;
  if (self.globalSettingsLoadError) throw new Error("Cannot save run budget: global settings failed to load");
  self.globalSettings.runBudget = policy;
  self.markModified("runBudget");
  self.save();
  await self.flush();
  const errors = self.drainErrors();
  const loaded = SettingsManager.tryLoadFromStorage(self.storage, "global");
  const persisted = loaded.settings.runBudget;
  if (errors.length > 0 || loaded.error || JSON.stringify(persisted) !== JSON.stringify(policy)) {
    self.globalSettings.runBudget = previous;
    self.settings.runBudget = previous;
    throw new Error("Cannot save run budget: settings write or readback failed; no new budget was authorized");
  }
}
