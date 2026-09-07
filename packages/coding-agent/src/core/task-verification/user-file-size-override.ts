import { USER_FILE_SIZE_OVERRIDE_DENIAL_PATTERN, USER_FILE_SIZE_OVERRIDE_PATTERN } from "./constants.ts";
import type { TaskVerificationState } from "./types.ts";

export function userFileSizeOverrideIsAuthorized(state: TaskVerificationState, latestUserPrompt: string): boolean {
  const persistedPrompts = (state.taskPrompts ?? []).map((prompt) => prompt.text).filter(hasText);
  const authoritativePrompts =
    persistedPrompts.length > 0 ? persistedPrompts : [state.taskContext, latestUserPrompt].filter(hasText);
  for (let index = authoritativePrompts.length - 1; index >= 0; index -= 1) {
    const prompt = authoritativePrompts[index]!;
    if (USER_FILE_SIZE_OVERRIDE_DENIAL_PATTERN.test(prompt)) return false;
    if (USER_FILE_SIZE_OVERRIDE_PATTERN.test(prompt)) return true;
  }
  return false;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
