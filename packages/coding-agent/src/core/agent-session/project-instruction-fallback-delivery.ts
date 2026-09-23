import type { ProjectInstructionDeliveryMode } from "../project-instructions/index.ts";
import type { AgentSession } from "./agentsession.ts";
import { persistProjectRuleSupersession } from "./project-instruction-integrity.ts";

/**
 * Compiled delivery whose prepared artifact is a compiler fallback (compiler unreachable, failed, or invalid)
 * degrades to legacy delivery: full AGENTS.md/CLAUDE.md context injection and no compiled mutation gate.
 */
export function isCompiledProjectInstructionFallbackActive(self: AgentSession): boolean {
  return (
    self._projectInstructionMode === "compiled" && self._projectInstructions.state.current?.manifest.mode === "fallback"
  );
}

/** Delivery for the currently prepared artifact; gating and new prompts follow it. */
export function resolveProjectInstructionDelivery(self: AgentSession): ProjectInstructionDeliveryMode {
  return isCompiledProjectInstructionFallbackActive(self) ? "legacy" : self._projectInstructionMode;
}

/**
 * Delivery the current run's system prompt was built with. Model-visible history follows it so a mid-run refresh
 * cannot rewrite the context (or its provider prefix cache) until the next user turn applies the new delivery.
 */
export function resolvePromptProjectInstructionDelivery(self: AgentSession): ProjectInstructionDeliveryMode {
  return self._projectInstructionMode === "compiled" && self._projectInstructionFallbackPromptActive
    ? "legacy"
    : self._projectInstructionMode;
}

/**
 * Align a new user turn with the currently prepared artifact. A refresh that changed between compiled and fallback
 * without rebuilding the system prompt between runs (a mid-run tool-hook refresh or a same-identity model switch)
 * is applied here. Entry into legacy fallback and recovery from an announced fallback are user-facing notices, never
 * model gates.
 */
export function syncProjectInstructionFallbackDelivery(self: AgentSession): void {
  const fallbackActive = isCompiledProjectInstructionFallbackActive(self);
  const prepared = self._projectInstructions.state.current;
  if (prepared && fallbackActive !== self._projectInstructionFallbackPromptActive) {
    // Batches from before the transition may be bound to an input hash that the fallback period replaced; supersede
    // them so a recovered compiled turn starts from the current artifact instead of an unverifiable old route.
    persistProjectRuleSupersession(self.sessionManager, prepared.manifest.inputHash, "delivery-change");
    self._projectRuleGate = undefined;
    self._projectRuleReadStages.clear();
    self._queuedProjectRuleGates = new WeakMap();
    self._processingQueuedProjectRuleTurn = false;
    self._baseSystemPrompt = self._rebuildSystemPrompt(self.getActiveToolNames());
    self.agent.state.systemPrompt = self._baseSystemPrompt;
  }
  const notice = self._projectInstructionFallbackNotice;
  if (!fallbackActive) {
    if (notice === "none") return;
    // The user was told about the fallback, so explain why read_rules gates reappear.
    self._projectInstructionFallbackNotice = "none";
    self._emit({
      type: "project_instructions_restored",
      message: "Compiled project rules restored; read_rules gates apply again.",
    });
    return;
  }
  if (notice === "announced") return;
  self._projectInstructionFallbackNotice = "announced";
  const diagnostic = prepared?.manifest.compilerDiagnostic;
  self._emit({
    type: "project_instructions_fallback",
    message: `Compiled project rules unavailable${diagnostic ? ` (${diagnostic})` : ""}; using legacy AGENTS.md/CLAUDE.md instructions until a /reload compiles them.`,
  });
}
