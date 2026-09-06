import type { TaskVerificationMode } from "../task-verification/mode.ts";
import type { TaskVerificationController } from "../task-verification.ts";

export interface InstalledTaskVerificationRuntime {
  configuredMode: Exclude<TaskVerificationMode, "off">;
  controller: TaskVerificationController;
  enabled: boolean;
  managedToolNames: ReadonlySet<string>;
}
