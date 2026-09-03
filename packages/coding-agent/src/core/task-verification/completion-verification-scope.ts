import { Type } from "typebox";

export const COMPLETION_VERIFICATION_SCOPES = [
  "runtime_behavior",
  "non_runtime_content",
  "external_operation",
  "response_only",
] as const;

export type CompletionVerificationScope = (typeof COMPLETION_VERIFICATION_SCOPES)[number];

export const CompletionVerificationScopeSchema = Type.Union([
  Type.Literal("runtime_behavior"),
  Type.Literal("non_runtime_content"),
  Type.Literal("external_operation"),
  Type.Literal("response_only"),
]);

export function completionVerificationScope(
  checklist: { verificationScope?: unknown } | undefined,
): CompletionVerificationScope {
  return isCompletionVerificationScope(checklist?.verificationScope) ? checklist.verificationScope : "runtime_behavior";
}

export function isCompletionVerificationScope(value: unknown): value is CompletionVerificationScope {
  return COMPLETION_VERIFICATION_SCOPES.some((scope) => scope === value);
}
