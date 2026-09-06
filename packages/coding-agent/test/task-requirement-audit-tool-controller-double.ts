import { emptyState } from "../src/core/task-verification/state-factories.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import type {
  RequirementAuditInput,
  TaskVerificationState,
  VerificationResult,
} from "../src/core/task-verification/types.ts";

interface RequirementAuditToolControllerDoubleOptions {
  taskId?: string;
  withGuidance?: (message: string) => string;
}

type ApplyRequirementAudit = (input: RequirementAuditInput, state: TaskVerificationState) => VerificationResult;

export function createRequirementAuditToolControllerDouble(
  applyRequirementAudit: ApplyRequirementAudit,
  options: RequirementAuditToolControllerDoubleOptions = {},
): { controller: TaskVerificationController; state: TaskVerificationState } {
  const state = emptyState(options.taskId ?? "requirement-audit-tool-test", "audit");
  state.requirementAudit.status = "awaiting_definition";
  const controller = {
    applyRequirementAudit: (input: RequirementAuditInput) => applyRequirementAudit(input, state),
    get currentState(): TaskVerificationState {
      return state;
    },
    formatNextRequirement: () => "NEXT REQUIRED ACTION: define requirements.",
    mode: "audit",
    persistState: () => {},
    rejected: (message: string): VerificationResult => ({ status: "needs_action", message, state }),
    state,
    withGuidance: options.withGuidance ?? ((message: string) => message),
  } as unknown as TaskVerificationController;
  return { controller, state };
}
