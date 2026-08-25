import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { findOversizedSourceFiles } from "../tool-classification.ts";
import { userFileSizeOverrideIsAuthorized } from "../user-file-size-override.ts";

export function mutationSourceSizeGuidance(self: TaskVerificationController): string | undefined {
  const fileSizeLimitOverridden = userFileSizeOverrideIsAuthorized(self.state, self.latestUserPrompt);
  if (fileSizeLimitOverridden) return undefined;
  if (self.state.mutatedSourcePathOverflow) {
    return "Source-size guard could not bound every mutated source path. Completion remains blocked unless the user explicitly overrides the file-size constraint.";
  }
  const oversizedFiles = findOversizedSourceFiles(
    self.sessionManager.getCwd(),
    fileSizeLimitOverridden,
    self.state.mutatedSourcePaths ?? [],
    250,
  );
  if (oversizedFiles.length === 0) return undefined;

  return [
    "Source-size guard: mutated source files already exceed the completion limit:",
    ...oversizedFiles.map((file) => `- ${file.path}: ${file.lineCount} lines (limit: 250)`),
    "Split oversized source files before broad verification. Preserve behavior with focused regression tests before and after the split.",
  ].join("\n");
}
