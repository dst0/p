import { createTaskVerificationSemanticTracker } from "../project-instructions/verification-semantic-proof.ts";
import type { AgentId, TaskVerificationMode } from "./runner-options.ts";

type SemanticEvent = Record<string, unknown>;

function requiresAcceptedFinish(agent: AgentId, mode: TaskVerificationMode | undefined): boolean {
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
  const requireAcceptedFinish = requiresAcceptedFinish(agent, mode);
  const verification = createTaskVerificationSemanticTracker();
  let acceptedBeforeMarker = 0;
  return {
    observe(metricOutput: string): void {
      if (!requireAcceptedFinish) return;
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
        acceptedBeforeMarker = verification.snapshot().acceptedFinishCount;
        return false;
      }
      return !requireAcceptedFinish || verification.snapshot().acceptedFinishCount > acceptedBeforeMarker;
    },
    waitingForAcceptedFinish(finishNotesCreated: boolean): boolean {
      return (
        finishNotesCreated &&
        requireAcceptedFinish &&
        verification.snapshot().acceptedFinishCount <= acceptedBeforeMarker
      );
    },
  };
}
