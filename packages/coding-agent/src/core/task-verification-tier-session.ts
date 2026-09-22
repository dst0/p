import type { InstalledTaskVerificationRuntime } from "./agent-session/task-verification-runtime-state.ts";
import type { AgentSession } from "./agent-session.ts";
import type { CustomMessage } from "./messages.ts";
import { effectEscalation, pathsAreLightCompatible } from "./task-verification/task-tier.ts";
import { resetAfterSuccessfulCompletion } from "./task-verification/taskverificationcontroller-methods/completion-lifecycle.ts";
import { isNonRequirementNudge } from "./task-verification/taskverificationcontroller-methods/non-requirement-nudge.ts";
import { ZERO_EFFECT_EVIDENCE_GUIDELINES } from "./task-verification/taskverificationcontroller-methods/task-verification-tool-definition.ts";
import { currentRequestedEffectIntent } from "./task-verification/taskverificationcontroller-methods/zero-effect-completion-gate.ts";
import type { TaskVerificationState } from "./task-verification/types.ts";
import type { TaskVerificationPolicy } from "./task-verification/verification-policy.ts";
import {
  VERIFICATION_TIER_NOTICE_CUSTOM_TYPE,
  type VerificationTierTransition,
} from "./task-verification-tier-runtime.ts";

/** Wires tier transitions to the session and applies the restored or initial tier. */
export function installVerificationTier(session: AgentSession, runtime: InstalledTaskVerificationRuntime): void {
  runtime.tier.setTransitionListener((transition) => applyVerificationTierTransition(session, runtime, transition));
  // Auto STRICT accepts a zero-effect text answer; a task that requires an effect is repaired once first.
  session.agent.allowImplicitCompletion = ({ missingFinishRetries }) =>
    runtime.enabled &&
    runtime.tier.policy === "auto" &&
    runtime.tier.tier === "strict" &&
    runtime.controller.state.mutationRevision === 0 &&
    (missingFinishRetries > 0 || currentRequestedEffectIntent(runtime.controller) !== "effect_required");
  runtime.observedLedger = new Set(runtime.controller.state.taskOwnedPaths ?? []);
  session.setActiveToolsByName(verificationTierToolNames(session, runtime));
}

/**
 * LIGHT behavior (implicit completion, short prompt, no checkpoints on success) applies only while the
 * controller is engaged; `off` and read-only allowlists keep the configured completion protocol.
 */
export function isLightTierActive(session: AgentSession): boolean {
  const runtime = session._taskVerificationRuntime;
  return runtime?.enabled === true && runtime.tier.tier === "light";
}

/** Active tool names for the current tier: LIGHT defers rare defaults, STRICT and `off` restore them. */
export function verificationTierToolNames(session: AgentSession, runtime: InstalledTaskVerificationRuntime): string[] {
  const active = session.getActiveToolNames();
  if (runtime.tier.tier === "light" && runtime.tier.policy !== "off") {
    return active.filter((name) => !runtime.tierManagedToolNames.includes(name));
  }
  return [...new Set([...active, ...runtime.tierManagedToolNames])];
}

function applyVerificationTierTransition(
  session: AgentSession,
  runtime: InstalledTaskVerificationRuntime,
  transition: VerificationTierTransition,
): void {
  session.setActiveToolsByName(verificationTierToolNames(session, runtime));
  session._emit({
    type: "verification_tier_changed",
    policy: transition.policy,
    tier: transition.tier,
    previousTier: transition.previousTier,
    reason: transition.reason,
    trigger: transition.trigger,
  });
}

/**
 * Recomputes the tier for a new user prompt before its run starts. A new substantive prompt after a
 * LIGHT task whose ledger holds only LIGHT-compatible effects starts a fresh controller task.
 */
export function beginVerificationTierPrompt(session: AgentSession, promptText: string): void {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return;
  const nudge = isNonRequirementNudge(promptText, runtime.controller.state.taskPrompts ?? []);
  if (!nudge && runtime.tier.tier === "light") resetCompletedLightTask(runtime);
  runtime.tier.beginPrompt(promptText, nudge);
}

/** Session `/verify` override. */
export function setVerificationPolicy(session: AgentSession, policy: TaskVerificationPolicy): boolean {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return false;
  runtime.tier.setPolicyOverride(policy);
  return true;
}

/** Forced LIGHT never verifies, so its ledger is never owed; under `auto` only LIGHT-compatible effects reset. */
function resetCompletedLightTask(runtime: InstalledTaskVerificationRuntime): void {
  const state = runtime.controller.state;
  const started = (state.taskPrompts?.length ?? 0) > 0 || state.mutationRevision > 0;
  if (!started || (runtime.tier.policy !== "light" && !ledgerIsLightCompatible(state))) return;
  resetAfterSuccessfulCompletion(runtime.controller);
  runtime.observedLedger = new Set();
}

/** True when the ledger owes nothing STRICT: no code/test/config paths, external receipts, or tracking gaps. */
function ledgerIsLightCompatible(state: TaskVerificationState): boolean {
  const untracked = state.taskOwnedPathTrackingFailed === true || state.effectTrackingFailed === true;
  return (
    !untracked &&
    (state.externalEffectReceipts?.length ?? 0) === 0 &&
    pathsAreLightCompatible(state.taskOwnedPaths ?? [])
  );
}

/** Effect backstop: escalates LIGHT to STRICT when the ledger gains a source, test, or build-config path. */
export function observeVerificationTierEffect(runtime: InstalledTaskVerificationRuntime): void {
  const previous = runtime.observedLedger;
  const current = new Set(runtime.controller.state.taskOwnedPaths ?? []);
  runtime.observedLedger = current;
  if (!runtime.tier.escalationEnabled || runtime.tier.tier === "strict") return;
  const decision = effectEscalation([...current].filter((path) => !previous.has(path)));
  if (decision) runtime.tier.escalate(decision.reason, decision.trigger);
}

/** Hidden tail message that tells the model about a mid-run escalation. */
export function createVerificationTierNoticeMessage(content: string, timestamp: number): CustomMessage {
  return { role: "custom", customType: VERIFICATION_TIER_NOTICE_CUSTOM_TYPE, content, display: false, timestamp };
}

/** Drops zero-effect ceremony guidelines while the auto policy accepts plain-text zero-effect endings. */
export function verificationToolGuidelines(session: AgentSession, guidelines: readonly string[]): string[] {
  if (session._taskVerificationRuntime?.tier.policy !== "auto") return [...guidelines];
  return guidelines.filter((guideline) => !ZERO_EFFECT_EVIDENCE_GUIDELINES.includes(guideline));
}
