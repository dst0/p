import type { InstalledTaskVerificationRuntime } from "./agent-session/task-verification-runtime-state.ts";
import type { AgentSession } from "./agent-session.ts";
import type { CustomMessage } from "./messages.ts";
import { LIGHT_DEFERRED_TOOL_NAMES, pathsAreLightCompatible } from "./task-verification/task-tier.ts";
import { resetAfterSuccessfulCompletion } from "./task-verification/taskverificationcontroller-methods/completion-lifecycle.ts";
import { isNonRequirementNudge } from "./task-verification/taskverificationcontroller-methods/non-requirement-nudge.ts";
import { ZERO_EFFECT_EVIDENCE_GUIDELINES } from "./task-verification/taskverificationcontroller-methods/task-verification-tool-definition.ts";
import { currentRequestedEffectIntent } from "./task-verification/taskverificationcontroller-methods/zero-effect-completion-gate.ts";
import type { TaskVerificationState } from "./task-verification/types.ts";
import type { TaskVerificationPolicy } from "./task-verification/verification-policy.ts";
import { snapshotObservedLedger } from "./task-verification-tier-effects.ts";
import {
  VERIFICATION_TIER_NOTICE_CUSTOM_TYPE,
  type VerificationTierTransition,
} from "./task-verification-tier-runtime.ts";

/** Wires tier transitions to the session and applies the restored or initial tier. */
export function installVerificationTier(session: AgentSession, runtime: InstalledTaskVerificationRuntime): void {
  runtime.tier.setTransitionListener((transition) => applyVerificationTierTransition(session, runtime, transition));
  session.agent.allowImplicitCompletion = ({ missingFinishRetries }) =>
    acceptZeroEffectTextCompletion(runtime, missingFinishRetries);
  session.subscribe((event) => {
    if (event.type === "compaction_end" && event.result) runtime.tier.allowDeEscalation();
  });
  runtime.observedLedger = snapshotObservedLedger(runtime.controller.state);
  session.setActiveToolsByName(verificationTierToolNames(session, runtime));
}

/**
 * Auto STRICT accepts a text answer while nothing changed (a task that requires an effect is repaired once
 * first). The accepted answer completes the controller task, so its prompts cannot force later repairs.
 */
function acceptZeroEffectTextCompletion(
  runtime: InstalledTaskVerificationRuntime,
  missingFinishRetries: number,
): boolean {
  const accept =
    runtime.enabled &&
    runtime.tier.policy === "auto" &&
    runtime.tier.tier === "strict" &&
    runtime.controller.state.mutationRevision === 0 &&
    (missingFinishRetries > 0 || currentRequestedEffectIntent(runtime.controller) !== "effect_required");
  if (accept) completeControllerTask(runtime);
  return accept;
}

/**
 * The lightweight protocol (short prompt, no state protocol, checkpoints only after errors) applies while
 * LIGHT, and whenever verification is not engaged (policy `off`, or a session without mutating tools),
 * except under forced `strict`, which keeps today's full protocol.
 */
export function isLightTierActive(session: AgentSession): boolean {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return session._verificationPolicyOff;
  return runtime.enabled ? runtime.tier.tier === "light" : runtime.tier.policy !== "strict";
}

/**
 * LIGHT and a session-level `off` end on the text answer. A session whose tools cannot change anything does
 * too, unless a completion mode was configured explicitly; forced `strict` keeps its configured protocol.
 */
export function forcesImplicitCompletion(session: AgentSession): boolean {
  const runtime = session._taskVerificationRuntime;
  if (!runtime || !isLightTierActive(session)) return false;
  return runtime.enabled || runtime.tier.policy === "off" || !runtime.completionModeExplicit;
}

/** Active tool names for the current tier: lightweight sessions defer rare defaults, STRICT restores them. */
export function verificationTierToolNames(session: AgentSession, runtime: InstalledTaskVerificationRuntime): string[] {
  const active = session.getActiveToolNames();
  if (runtime.tier.tier === "light") return active.filter((name) => !runtime.tierManagedToolNames.includes(name));
  return [...new Set([...active, ...runtime.tierManagedToolNames])];
}

/** Settings-level `off` installs no controller but still uses the lightweight tool set. */
export function installVerificationOff(session: AgentSession): void {
  session._verificationPolicyOff = true;
  const active = session.getActiveToolNames();
  const deferred = session._allowedToolNames === undefined ? LIGHT_DEFERRED_TOOL_NAMES : [];
  session.setActiveToolsByName(active.filter((name) => !deferred.includes(name)));
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
  applyPendingPolicy(runtime);
  const nudge = isNonRequirementNudge(promptText, runtime.controller.state.taskPrompts ?? []);
  if (!nudge && runtime.tier.tier === "light") resetCompletedLightTask(runtime);
  runtime.tier.beginPrompt(promptText, nudge);
}

/**
 * Turn-boundary hook: applies a policy override requested mid-run, and lets queued steering or follow-up
 * messages escalate the tier before the request that answers them. Queued messages never de-escalate.
 */
export function applyQueuedVerificationChanges(session: AgentSession): void {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return;
  applyPendingPolicy(runtime);
  const taskPrompts = runtime.controller.state.taskPrompts ?? [];
  for (const text of [...session._steeringMessages, ...session._followUpMessages]) {
    runtime.tier.beginPrompt(text, isNonRequirementNudge(text, taskPrompts), { escalateOnly: true });
  }
}

/** Session `/verify` override; while a run streams it is queued for the next turn boundary. */
export function setVerificationPolicy(session: AgentSession, policy: TaskVerificationPolicy): boolean {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return false;
  runtime.pendingPolicy = policy;
  if (!session.isStreaming) applyPendingPolicy(runtime);
  return true;
}

function applyPendingPolicy(runtime: InstalledTaskVerificationRuntime): void {
  const policy = runtime.pendingPolicy;
  runtime.pendingPolicy = undefined;
  if (policy) runtime.tier.setPolicyOverride(policy);
}

/** Restores the tier recorded on the branch selected by tree navigation. */
export function restoreVerificationTierFromBranch(session: AgentSession): void {
  const runtime = session._taskVerificationRuntime;
  if (!runtime) return;
  const previousTier = runtime.tier.tier;
  runtime.tier.restore(session.sessionManager.getBranch());
  session.setActiveToolsByName(verificationTierToolNames(session, runtime));
  if (runtime.tier.tier === previousTier) return;
  session._emit({
    type: "verification_tier_changed",
    policy: runtime.tier.policy,
    tier: runtime.tier.tier,
    previousTier,
    reason: runtime.tier.reason,
    trigger: runtime.tier.trigger,
  });
}

/** Forced LIGHT never verifies, so its ledger is never owed; under `auto` only LIGHT-compatible effects reset. */
function resetCompletedLightTask(runtime: InstalledTaskVerificationRuntime): void {
  const state = runtime.controller.state;
  const started = (state.taskPrompts?.length ?? 0) > 0 || state.mutationRevision > 0;
  if (!started || (runtime.tier.policy !== "light" && !ledgerIsLightCompatible(state))) return;
  completeControllerTask(runtime);
}

function completeControllerTask(runtime: InstalledTaskVerificationRuntime): void {
  resetAfterSuccessfulCompletion(runtime.controller);
  runtime.observedLedger = snapshotObservedLedger(runtime.controller.state);
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

/** Hidden tail message that tells the model about a mid-run escalation. */
export function createVerificationTierNoticeMessage(content: string, timestamp: number): CustomMessage {
  return { role: "custom", customType: VERIFICATION_TIER_NOTICE_CUSTOM_TYPE, content, display: false, timestamp };
}

/** Drops zero-effect ceremony guidelines while the auto policy accepts plain-text zero-effect endings. */
export function verificationToolGuidelines(session: AgentSession, guidelines: readonly string[]): string[] {
  if (session._taskVerificationRuntime?.tier.policy !== "auto") return [...guidelines];
  return guidelines.filter((guideline) => !ZERO_EFFECT_EVIDENCE_GUIDELINES.includes(guideline));
}
