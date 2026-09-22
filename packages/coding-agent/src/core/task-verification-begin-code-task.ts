import type { TaskVerificationController } from "./task-verification/taskverificationcontroller.ts";
import type { TaskVerificationTierRuntime } from "./task-verification-tier-runtime.ts";
import type { BeginCodeTaskInput, BeginCodeTaskOutcome } from "./tools/begin-code-task.ts";

const FINISH_STEPS =
  'After the final change, run focused tests, call record_task_verification {"action":"ready_to_finish"}, then finish_work. If you end up changing nothing, answer in plain text.';

/**
 * Handles the model's `begin_code_task` signal: escalates to STRICT and, for the evidence engine,
 * records the checklist so the first code change is not blocked by the checklist gate.
 */
export function beginCodeTask(
  tier: TaskVerificationTierRuntime,
  controller: TaskVerificationController,
  input: BeginCodeTaskInput,
): BeginCodeTaskOutcome {
  tier.escalate("model_declared", input.goal.slice(0, 120));
  if (controller.mode !== "evidence") {
    return {
      text: `Verification is now STRICT. Follow the record_task_verification guidance for this task, then finish_work.`,
      checklistRecorded: false,
    };
  }
  const result = controller.applyInput({
    action: "record_completion_checklist",
    completion_checklist: input.checklist,
    verification_scope: "runtime_behavior",
  });
  if (result.status !== "updated") {
    return {
      text: `Verification is now STRICT. The checklist was not recorded: ${result.message}\nRecord it with record_task_verification action "record_completion_checklist" before your next change. ${FINISH_STEPS}`,
      checklistRecorded: false,
    };
  }
  // An effect escalation earlier in this batch queued a "record a checklist" notice that is now satisfied.
  tier.takeNotice();
  return {
    text: `Verification is now STRICT. Checklist recorded (${input.checklist.length} item${input.checklist.length === 1 ? "" : "s"}). ${FINISH_STEPS}`,
    checklistRecorded: true,
  };
}
