import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import { requirementDefinitionMatchesState } from "../requirement-audit-hashing.ts";
import { requirementDefinitionPolicyActive } from "../requirement-definition-policy.ts";
import { formatRequirementDefinitionPrompt } from "../requirement-definition-prompt.ts";
import { requirementDefinitionSources } from "../requirement-source-storage.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { canPotentiallyChangeWorkspace } from "./requirement-source-gate.ts";

export function requirementDefinitionMutationGate(
  self: TaskVerificationController,
  toolName: string,
  args: unknown,
): BeforeToolCallResult | undefined {
  if (!requirementDefinitionPolicyActive(self.state) || !canPotentiallyChangeWorkspace(toolName, args)) {
    return undefined;
  }
  if (requirementDefinitionMatchesState(self.state)) return undefined;

  const sources = requirementDefinitionSources(self.state, self.requirementSourceTexts);
  return self.blocked(
    [
      "Cannot change the workspace before one accepted complete requirement definition.",
      typeof sources === "string" ? sources : formatRequirementDefinitionPrompt(sources),
    ].join("\n"),
  );
}
