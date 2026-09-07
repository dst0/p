import type { ToolResultMessage } from "@dst0/p-ai";

export function createVerifiedCompletionResult(
  summary: string,
  toolName = "record_requirement_audit",
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "audit-1",
    toolName,
    content: [{ type: "text", text: "untrusted result text" }],
    isError: false,
    timestamp: Date.now(),
    details: {
      verifiedCompletion: {
        kind: "task_verification_completion",
        version: 1,
        status: "success",
        summary,
        files_changed: ["src/result.ts"],
        certificate_hash: "a".repeat(64),
      },
    },
  };
}
