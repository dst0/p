import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { evidenceCriticalProofRequirement } from "../evidence-critical-proof.ts";
import { isProductInvariantRequirementType } from "../requirement-risk.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool, shellCommand } from "../tool-classification.ts";
import { focusedTestSelectors, isFocusedEvidence } from "./focused-requirement-evidence.ts";
import { formatFocusedSelectorExample, formatRequirementProofPlan } from "./requirement-audit-prompt.ts";
import { commandContainsTestInvocation } from "./test-command-invocation.ts";

export function requirementProofCommandGate(
  self: TaskVerificationController,
  toolName: string,
  args: unknown,
): BeforeToolCallResult | undefined {
  if (self.state.mutationRevision === 0) return undefined;
  if (!isShellTool(toolName)) return undefined;
  const command = shellCommand(args);
  if (!commandContainsTestInvocation(command)) return undefined;
  const evidence = [...self.evidence.values()].filter(
    (item) => item.mutationRevision === self.state.mutationRevision && !item.isError,
  );
  const proofRequirements =
    self.mode === "evidence"
      ? (self.state.criticalProofObligations ?? []).map(evidenceCriticalProofRequirement)
      : (self.state.requirementAudit?.requirements ?? []);
  const pending = [...new Map(proofRequirements.map((requirement) => [requirement.id, requirement])).values()].filter(
    (requirement) =>
      isProductInvariantRequirementType(requirement.type) &&
      (requirement.proofPolicies?.length ?? 0) > 0 &&
      !evidence.some((item) => isFocusedEvidence(self, item, requirement)),
  );
  if (pending.length === 0) return undefined;
  const selectors = focusedTestSelectors(command);
  if (
    selectors?.length === 1 &&
    pending.some((requirement) => selectors[0] === formatFocusedSelectorExample(requirement))
  ) {
    return undefined;
  }
  return self.blocked(
    [
      "A broad or shortened test command cannot run before the pending controller proof selector.",
      formatRequirementProofPlan(pending),
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
  );
}
