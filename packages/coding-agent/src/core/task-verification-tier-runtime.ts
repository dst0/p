import type { SessionEntry } from "./session-manager.ts";
import {
  initialVerificationTier,
  VERIFICATION_TIER_REASONS,
  type VerificationTier,
  type VerificationTierDecision,
  type VerificationTierReason,
} from "./task-verification/task-tier.ts";
import { isTaskVerificationPolicy, type TaskVerificationPolicy } from "./task-verification/verification-policy.ts";

export const TASK_VERIFICATION_TIER_CUSTOM_TYPE = "task_verification_tier";
export const VERIFICATION_TIER_NOTICE_CUSTOM_TYPE = "verification_tier";

/** Persisted tier transition, restored on resume and after compaction. */
export interface TaskVerificationTierEntry {
  version: 1;
  policy: TaskVerificationPolicy;
  /** True when `policy` came from a session `/verify` override rather than settings. */
  policyOverride: boolean;
  tier: VerificationTier;
  reason: VerificationTierReason;
  trigger?: string;
}

export interface VerificationTierTransition extends VerificationTierDecision {
  previousTier: VerificationTier;
  policy: TaskVerificationPolicy;
}

export interface TaskVerificationTierRuntimeOptions {
  configuredPolicy: TaskVerificationPolicy;
  persist(entry: TaskVerificationTierEntry): void;
}

const ESCALATION_CAUSES: Partial<Record<VerificationTierReason, string>> = {
  effect_source: "source change",
  effect_test: "test change",
  effect_config: "build config change",
  effect_untracked: "untracked change",
  model_declared: "begin_code_task",
  prior: "code task",
  user_override: "/verify",
};

function isTierEntry(value: unknown): value is TaskVerificationTierEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.version === 1 &&
    isTaskVerificationPolicy(entry.policy) &&
    typeof entry.policyOverride === "boolean" &&
    (entry.tier === "light" || entry.tier === "strict") &&
    (VERIFICATION_TIER_REASONS as readonly unknown[]).includes(entry.reason) &&
    (entry.trigger === undefined || typeof entry.trigger === "string")
  );
}

/** Short human-readable cause, e.g. "source change: src/a.ts". */
export function describeTierCause(reason: VerificationTierReason, trigger?: string): string {
  const cause = ESCALATION_CAUSES[reason] ?? reason;
  return trigger ? `${cause}: ${trigger}` : cause;
}

/**
 * Per-session verification tier state machine.
 *
 * A new, non-nudge prompt recomputes the tier from the policy and the deterministic prior. Under `auto`, an
 * escalated session stays STRICT until the next compaction, resume, or policy change, so alternating tiers
 * never thrash the provider's prompt cache; during a run the tier may only escalate.
 */
export class TaskVerificationTierRuntime {
  private readonly configuredPolicy: TaskVerificationPolicy;
  private readonly persist: (entry: TaskVerificationTierEntry) => void;
  private overridePolicy: TaskVerificationPolicy | undefined;
  private currentTier: VerificationTier;
  private currentReason: VerificationTierReason = "default";
  private currentTrigger: string | undefined;
  private pendingNotice: string | undefined;
  private deEscalationAllowed = true;
  private transitionListener: ((transition: VerificationTierTransition) => void) | undefined;

  constructor(options: TaskVerificationTierRuntimeOptions) {
    this.configuredPolicy = options.configuredPolicy;
    this.persist = options.persist;
    this.currentTier = options.configuredPolicy === "strict" ? "strict" : "light";
  }

  get policy(): TaskVerificationPolicy {
    return this.overridePolicy ?? this.configuredPolicy;
  }

  get policyOverridden(): boolean {
    return this.overridePolicy !== undefined;
  }

  get tier(): VerificationTier {
    return this.currentTier;
  }

  get reason(): VerificationTierReason {
    return this.currentReason;
  }

  get trigger(): string | undefined {
    return this.currentTrigger;
  }

  /** Only `auto` escalates from model signals and observed effects. */
  get escalationEnabled(): boolean {
    return this.policy === "auto";
  }

  /**
   * Restores the latest persisted tier on the branch, or the configured default when none exists. The
   * provider cache is cold after a resume or tree navigation, so the next prompt may de-escalate.
   */
  restore(entries: readonly SessionEntry[]): void {
    let data: TaskVerificationTierEntry | undefined;
    for (let index = entries.length - 1; index >= 0 && !data; index--) {
      const entry = entries[index];
      if (
        entry?.type === "custom" &&
        entry.customType === TASK_VERIFICATION_TIER_CUSTOM_TYPE &&
        isTierEntry(entry.data)
      ) {
        data = entry.data;
      }
    }
    this.overridePolicy = data?.policyOverride ? data.policy : undefined;
    const policy = this.policy;
    this.currentTier = policy === "strict" ? "strict" : policy === "auto" && data ? data.tier : "light";
    this.currentReason = data?.reason ?? "default";
    this.currentTrigger = data?.trigger;
    this.pendingNotice = undefined;
    this.deEscalationAllowed = true;
  }

  /** Compaction rebuilds the prompt prefix anyway, so the next prompt may return an escalated session to LIGHT. */
  allowDeEscalation(): void {
    this.deEscalationAllowed = true;
  }

  /**
   * Recomputes the tier for a user prompt; nudges such as "continue" keep the current tier. Under `auto`,
   * STRICT is kept until de-escalation is allowed, and `escalateOnly` (queued mid-run messages) never lowers it.
   */
  beginPrompt(
    promptText: string,
    isNudge: boolean,
    options: { escalateOnly?: boolean } = {},
  ): VerificationTierTransition | undefined {
    if (isNudge) return undefined;
    const policy = this.policy;
    const decision: VerificationTierDecision =
      policy === "off" ? { tier: "light", reason: "user_override" } : initialVerificationTier(policy, promptText);
    const keepStrict =
      policy === "auto" &&
      decision.tier === "light" &&
      this.currentTier === "strict" &&
      (options.escalateOnly === true || !this.deEscalationAllowed);
    return keepStrict ? undefined : this.transition(decision);
  }

  /** Escalates LIGHT to STRICT under `auto`; returns undefined when nothing changed. */
  escalate(reason: VerificationTierReason, trigger?: string): VerificationTierTransition | undefined {
    if (!this.escalationEnabled || this.currentTier === "strict") return undefined;
    const transition = this.transition({ tier: "strict", reason, trigger });
    if (transition && reason !== "model_declared") this.pendingNotice = formatEscalationNotice(transition);
    return transition;
  }

  /** Applies a session `/verify` override and always persists it. */
  setPolicyOverride(policy: TaskVerificationPolicy): VerificationTierTransition {
    this.overridePolicy = policy;
    const tier: VerificationTier = policy === "strict" ? "strict" : policy === "auto" ? this.currentTier : "light";
    const transition = this.record({ tier, reason: "user_override" });
    this.deEscalationAllowed = true;
    return transition;
  }

  /** Receives every recorded transition, after it was persisted. */
  setTransitionListener(listener: (transition: VerificationTierTransition) => void): void {
    this.transitionListener = listener;
  }

  /** Returns the pending escalation notice once. */
  takeNotice(): string | undefined {
    const notice = this.pendingNotice;
    this.pendingNotice = undefined;
    return notice;
  }

  private transition(decision: VerificationTierDecision): VerificationTierTransition | undefined {
    return decision.tier === this.currentTier ? undefined : this.record(decision);
  }

  private record(decision: VerificationTierDecision): VerificationTierTransition {
    const previousTier = this.currentTier;
    this.currentTier = decision.tier;
    this.currentReason = decision.reason;
    this.currentTrigger = decision.trigger;
    if (decision.tier === "light") this.pendingNotice = undefined;
    else this.deEscalationAllowed = false;
    const policy = this.policy;
    this.persist({
      version: 1,
      policy,
      policyOverride: this.overridePolicy !== undefined,
      tier: decision.tier,
      reason: decision.reason,
      ...(decision.trigger ? { trigger: decision.trigger } : {}),
    });
    const transition = { ...decision, previousTier, policy };
    this.transitionListener?.(transition);
    return transition;
  }
}

function formatEscalationNotice(transition: VerificationTierTransition): string {
  return [
    "<verification_tier>",
    `Verification is now STRICT (${describeTierCause(transition.reason, transition.trigger).slice(0, 40)}).`,
    "Record a completion checklist with record_task_verification before the next change.",
    "After the last change, verify, call ready_to_finish, then finish_work. Text-only endings are rejected.",
    "</verification_tier>",
  ].join("\n");
}
