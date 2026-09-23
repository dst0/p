import type { VerificationTierStatus } from "../../../../core/agent-session/agentsession-verification-methods.ts";
import type { AgentSession } from "../../../../core/agent-session.ts";
import { isTaskVerificationPolicy } from "../../../../core/task-verification/verification-policy.ts";
import { describeTierCause } from "../../../../core/task-verification-tier-runtime.ts";

interface VerifyCommandContext {
  session: Pick<AgentSession, "getVerificationTierStatus" | "setVerificationPolicy" | "isStreaming">;
  showStatus(message: string): void;
  showWarning(message: string): void;
  footer: { invalidate(): void };
  ui: { requestRender(): void };
}

const USAGE = "Usage: /verify [auto|light|strict|off] — no argument shows the current verification tier.";

export function formatVerificationStatus(status: VerificationTierStatus): string {
  const source = status.policyOverridden ? "session override" : "settings";
  const tier = status.active ? `tier ${status.tier.toUpperCase()}` : "nothing verified";
  const pending = status.pendingPolicy ? `; switches to ${status.pendingPolicy} at the next turn` : "";
  return `Verification: ${status.policy} (${source}); ${tier} — ${describeTierCause(status.reason, status.trigger)}${pending}`;
}

/** `/verify [auto|light|strict|off]`: show or override the verification policy for this session. */
export function handleVerifyCommand(self: VerifyCommandContext, text: string): void {
  const argument = text.replace(/^\/verify\s*/u, "").trim();
  if (argument === "" || argument === "status") {
    showVerificationStatus(self, self.session.getVerificationTierStatus());
    return;
  }
  if (!isTaskVerificationPolicy(argument)) {
    self.showWarning(USAGE);
    return;
  }
  if (self.session.isStreaming) {
    self.showWarning("Stop active work before changing verification.");
    return;
  }
  showVerificationStatus(self, self.session.setVerificationPolicy(argument));
}

function showVerificationStatus(self: VerifyCommandContext, status: VerificationTierStatus | undefined): void {
  if (!status) {
    self.showWarning(
      "Task verification is off in settings. Restart with --task-verification auto, light, or strict to use tiers.",
    );
    return;
  }
  self.showStatus(formatVerificationStatus(status));
  self.footer.invalidate();
  self.ui.requestRender();
}
