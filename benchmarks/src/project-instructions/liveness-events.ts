import { describeBenchmarkProjectInstructionAction, inferBenchmarkProjectInstructionActionPhases } from "./routing.ts";

export type SemanticTool = { phase: string; settledPhase: string };

export type SemanticEventState = {
  now: () => number;
  startedAt: number;
  phase: string;
  firstMutationElapsedMs?: number;
  semanticEventCount: number;
  mutationCount: number;
  requirementDefinitionAttemptCount: number;
  seenToolEvents: Set<string>;
  activeTools: Map<string, SemanticTool>;
};

export function processSemanticLine(state: SemanticEventState, line: string): void {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(event)) return;
  if (event.type === "tool_execution_end") {
    const key = String(event.toolCallId ?? event.benchmarkEventOrdinal ?? "");
    const completed = state.activeTools.get(key);
    if (!completed) return;
    state.activeTools.delete(key);
    state.phase = [...state.activeTools.values()].at(-1)?.phase ?? completed.settledPhase;
    return;
  }
  if (event.type !== "tool_execution_start" || typeof event.toolName !== "string") return;
  const identity = event.toolCallId ?? event.benchmarkEventOrdinal;
  const key = String(identity ?? `anonymous-${state.semanticEventCount}`);
  if (identity !== undefined) {
    if (state.seenToolEvents.has(key)) return;
    state.seenToolEvents.add(key);
  }
  state.semanticEventCount += 1;
  if (event.toolName === "record_requirement_audit") {
    const defining = isRecord(event.args) && event.args.action === "define";
    if (defining) state.requirementDefinitionAttemptCount += 1;
    const phase = defining ? "requirement_definition" : "verification";
    state.activeTools.set(key, { phase, settledPhase: defining ? "planning" : "idle" });
    state.phase = phase;
    return;
  }
  const toolDescription = typeof event.toolDescription === "string" ? event.toolDescription : undefined;
  const action = describeBenchmarkProjectInstructionAction(event.toolName, event.args, toolDescription);
  if (!action) {
    const phase = semanticPhase(
      inferBenchmarkProjectInstructionActionPhases(event.toolName, event.args, toolDescription),
    );
    state.activeTools.set(key, { phase: phase ?? "action", settledPhase: "idle" });
    if (phase) state.phase = phase;
    return;
  }
  state.mutationCount += 1;
  state.firstMutationElapsedMs ??= Math.max(0, state.now() - state.startedAt);
  state.phase = semanticPhase(action.phases) ?? "action";
  state.activeTools.set(key, { phase: state.phase, settledPhase: "idle" });
}

function semanticPhase(phases: string[]): string | undefined {
  return ["delivery", "closure", "verification", "testing", "implementation", "planning", "discovery", "intake"].find(
    (phase) => phases.includes(phase),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
