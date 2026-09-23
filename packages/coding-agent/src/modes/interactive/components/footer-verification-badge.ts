import type { VerificationTierStatus } from "../../../core/agent-session/agentsession-verification-methods.ts";
import type { ThemeColor } from "../theme/theme.ts";

export interface VerificationTierBadge {
  text: string;
  color: ThemeColor;
}

/**
 * Footer badge from actual behavior: OFF when nothing is verified (policy `off` or no mutating tools),
 * otherwise LIGHT, STRICT·auto (escalated under `auto`), or STRICT (forced); none without a configuration.
 */
export function formatVerificationTierBadge(
  status: VerificationTierStatus | undefined,
): VerificationTierBadge | undefined {
  if (!status) return undefined;
  if (!status.active) return { text: "OFF", color: "dim" };
  if (status.tier === "light") return { text: "LIGHT", color: "dim" };
  return { text: status.policy === "auto" ? "STRICT·auto" : "STRICT", color: "accent" };
}
