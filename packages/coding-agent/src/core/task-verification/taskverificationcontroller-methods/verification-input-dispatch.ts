import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { VerificationInput, VerificationResult } from "../types.ts";

export function applyVerificationInput(self: TaskVerificationController, input: VerificationInput): VerificationResult {
  switch (input.action) {
    case "declare_task":
      return self.declareTask(input);
    case "authorize_baseline_test":
      return self.authorizeBaselineTest(input);
    case "record_baseline":
      return self.recordBaseline(input);
    case "record_final":
      return self.recordFinal(input);
    case "ready_to_finish":
      return self.readyToFinish(input);
    case "status":
      return self.updated(self.formatStatus(), false);
  }
}
