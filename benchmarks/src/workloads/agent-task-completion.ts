import { createTaskVerificationSemanticTracker } from "../project-instructions/verification-semantic-proof.ts";
import type { AgentId, TaskVerificationMode } from "./runner-options.ts";

type SemanticEvent = Record<string, unknown>;

function requiresAcceptedCompletion(agent: AgentId, mode: TaskVerificationMode | undefined): boolean {
  return agent === "p" && mode !== "off";
}

function parseSemanticEvent(line: string): SemanticEvent | undefined {
  try {
    const event: unknown = JSON.parse(line);
    return typeof event === "object" && event !== null && !Array.isArray(event) ? (event as SemanticEvent) : undefined;
  } catch {
    return undefined;
  }
}

export function createAgentTaskCompletionGuard(agent: AgentId, mode: TaskVerificationMode | undefined) {
  const requireAcceptedCompletion = requiresAcceptedCompletion(agent, mode);
  const verification = createTaskVerificationSemanticTracker();
  const acceptedCompletionCount = (): number => {
    const evidence = verification.snapshot();
    return evidence.acceptedFinishCount + (mode === "audit" ? evidence.acceptedTerminalCompletionCount : 0);
  };
  let acceptedBeforeMarker = 0;
  return {
    observe(metricOutput: string): void {
      if (!requireAcceptedCompletion) return;
      for (const line of metricOutput.split("\n")) {
        const event = parseSemanticEvent(line);
        if (!event) continue;
        if (event.type === "turn_end") {
          verification.endTurn();
          continue;
        }
        verification.start(event);
        verification.end(event);
      }
      verification.endTurn();
    },
    shouldStop(turnFailed: boolean, finishNotesCreated: boolean): boolean {
      if (turnFailed) return true;
      if (!finishNotesCreated) {
        acceptedBeforeMarker = acceptedCompletionCount();
        return false;
      }
      return !requireAcceptedCompletion || acceptedCompletionCount() > acceptedBeforeMarker;
    },
    waitingForAcceptedCompletion(finishNotesCreated: boolean): boolean {
      return finishNotesCreated && requireAcceptedCompletion && acceptedCompletionCount() <= acceptedBeforeMarker;
    },
  };
}
