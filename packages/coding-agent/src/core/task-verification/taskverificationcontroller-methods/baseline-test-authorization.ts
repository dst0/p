import { isAbsolute } from "node:path";
import { TEST_PATH_PATTERN } from "../constants.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { normalizeStrings } from "../tool-classification.ts";
import type { VerificationInput, VerificationResult } from "../types.ts";

export function do_authorizeBaselineTest(
  self: TaskVerificationController,
  input: VerificationInput,
): VerificationResult {
  if (!self.state.taskKind || self.state.baseline.status !== "pending")
    return self.rejected("Baseline test authorization requires a declared task with pending baseline verification.");
  if (self.state.mutationRevision !== 0)
    return self.rejected("Cannot authorize baseline test edits after production mutation.");
  const requestedPaths = normalizeStrings(input.test_paths);
  if (requestedPaths.length === 0) return self.rejected("authorize_baseline_test requires test_paths.");
  const normalizedPaths: string[] = [];
  for (const filePath of requestedPaths) {
    const portablePath = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (isAbsolute(filePath) || portablePath.split("/").includes("..") || !TEST_PATH_PATTERN.test(portablePath)) {
      return self.rejected(`Only explicit repository-relative test files may be authorized: ${filePath}`);
    }
    normalizedPaths.push(portablePath);
  }
  self.state = {
    ...self.state,
    baseline: {
      ...self.state.baseline,
      authorizedTestPaths: [...new Set(normalizedPaths)],
      testSetupChanged: false,
    },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return self.updated(`Authorized test-only baseline setup for: ${self.state.baseline.authorizedTestPaths.join(", ")}`);
}
