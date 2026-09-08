import type { AppMode } from "../core/project-trust.ts";
import { parseRunBudgetArgument, type RunBudgetPolicy } from "../core/run-budget-policy.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { time } from "../core/timings.ts";
import { shouldRunFirstTimeSetup, showFirstTimeSetup, showStartupInput, showStartupSelector } from "./startup-ui.ts";

export interface RunBudgetChoiceUI {
  select(title: string, choices: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}

export interface StartupRunBudgetPolicies {
  current: RunBudgetPolicy;
  defaultPolicy: RunBudgetPolicy | undefined;
}

export async function resolveStartupChoices(
  settings: SettingsManager,
  mode: AppMode,
  explicit?: RunBudgetPolicy,
  resumed?: RunBudgetPolicy,
): Promise<StartupRunBudgetPolicies | undefined> {
  const initialSetup = mode === "interactive" && shouldRunFirstTimeSetup();
  const policies = await resolveStartupBudgetPolicies(settings, mode, explicit, resumed);
  if (policies && initialSetup) {
    await showFirstTimeSetup(settings);
    time("firstTimeSetup");
  }
  return policies;
}

export async function chooseRunBudget(ui: RunBudgetChoiceUI): Promise<RunBudgetPolicy | undefined> {
  const mode = await ui.select("Choose your task budget — saved as your default", [
    "Unlimited — no spending ceiling",
    "Limited — set a task budget",
  ]);
  if (mode === undefined) return undefined;
  if (mode === "Unlimited — no spending ceiling") return { mode: "unlimited" };
  if (mode !== "Limited — set a task budget") throw new Error("Invalid budget choice");
  const units = ["Model requests", "Cumulative tokens", "Estimated USD"];
  const selected = await ui.select("Limit this task by", units);
  if (selected === undefined) return undefined;
  const unit = (["requests", "tokens", "usd"] as const)[units.indexOf(selected)];
  if (!unit) throw new Error("Invalid budget unit");
  const detail =
    unit === "requests"
      ? "Includes retries and helper model calls; provider-internal network retries may add attempts."
      : unit === "tokens"
        ? "Input + output + cache tokens. The final response can exceed this threshold."
        : "Requires model pricing. Estimate, not an invoice cap; the final response can exceed it.";
  let error = "";
  while (true) {
    const amount = await ui.input(`${error}Task limit: ${selected}\n${detail}`, "Positive amount");
    if (amount === undefined) return undefined;
    try {
      return parseRunBudgetArgument(`${unit}:${amount.trim()}`);
    } catch {
      error = "Invalid amount. Enter a positive number (whole for requests/tokens).\n";
    }
  }
}

/** Cancel or configuration failure returns without constructing a runtime or spending. */
export async function resolveStartupRunBudget(
  settings: SettingsManager,
  mode: AppMode,
  explicit?: RunBudgetPolicy,
  resumed?: RunBudgetPolicy,
): Promise<RunBudgetPolicy | undefined> {
  return (await resolveStartupBudgetPolicies(settings, mode, explicit, resumed))?.current;
}

export async function resolveStartupBudgetPolicies(
  settings: SettingsManager,
  mode: AppMode,
  explicit?: RunBudgetPolicy,
  resumed?: RunBudgetPolicy,
): Promise<StartupRunBudgetPolicies | undefined> {
  try {
    const saved = settings.getRunBudgetPolicy();
    const current = explicit ?? resumed ?? saved;
    if (current) return { current, defaultPolicy: saved };
    if (mode !== "interactive")
      throw new Error(
        "budget_required: Choose --budget unlimited, requests:N, tokens:N, or usd:N before starting a task.",
      );
    const selected = await chooseRunBudget({
      select: (title, choices) =>
        showStartupSelector(
          settings,
          title,
          choices.map((value) => ({ label: value, value })),
        ),
      input: (title, placeholder) => showStartupInput(settings, title, placeholder),
    });
    if (selected) await settings.setRunBudgetPolicy(selected);
    return selected ? { current: selected, defaultPolicy: selected } : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not configure task budget";
    const code = message.startsWith("budget_required:") ? "budget_required" : "budget_configuration_error";
    console.error(mode === "json" || mode === "rpc" ? JSON.stringify({ type: "error", code, message }) : message);
    process.exitCode = 1;
    return undefined;
  }
}
