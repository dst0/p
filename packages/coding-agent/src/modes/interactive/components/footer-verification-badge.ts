import type { VerificationTierStatus } from "../../../core/agent-session/agentsession-verification-methods.ts";
import type { ThemeColor } from "../theme/theme.ts";

export interface VerificationTierBadge {
  text: string;
  color: ThemeColor;
}

/** Footer badge: LIGHT, STRICT·auto (auto-escalated), STRICT (forced), or OFF; none when verification is off in settings. */
export function formatVerificationTierBadge(
  status: VerificationTierStatus | undefined,
): VerificationTierBadge | undefined {
  if (!status) return undefined;
  if (status.policy === "off") return { text: "OFF", color: "warning" };
  if (status.tier === "light") return { text: "LIGHT", color: "dim" };
  return { text: status.policy === "auto" ? "STRICT·auto" : "STRICT", color: "accent" };
}
