import type { CompletionMode } from "../completion-protocol.ts";

export const DEFAULT_COMPLETION_MODE: CompletionMode = "explicit_finish";

export const DEFAULT_MAX_TURNS = Number.POSITIVE_INFINITY;

export const DEFAULT_MAX_NO_PROGRESS_TURNS = 5;

export const DEFAULT_MAX_CONSECUTIVE_WAITING_TURNS = 3;

export const DEFAULT_MAX_MALFORMED_TOOL_RETRIES = 3;

export const DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES = 3;

export const DEFAULT_MAX_MISSING_FINISH_RETRIES = 15;

export const MISSING_FINISH_WORK_REPAIR_MESSAGE =
  "The task is not complete because you did not call `finish_work`.\n" +
  "Continue working by calling the appropriate tools, or call `finish_work` if you believe the work is genuinely done.\n" +
  "Do not provide a normal assistant final answer in this mode.";

export const MALFORMED_TOOL_CALL_REPAIR_MESSAGE =
  "Your previous tool call appears to be incomplete, malformed, or truncated.\n" +
  "If you need to wait, call `sleep` with `{ seconds, check: { tool, arguments } }`; bare waits are invalid.\n" +
  "The runtime will execute the check immediately after the wait.\n" +
  "Re-emit the intended tool call in valid form, or call `finish_work` if the task is complete.\n" +
  "Do not explain. Call a tool.";

export const REPETITIVE_MODEL_OUTPUT_REPAIR_MESSAGE =
  "Your previous response entered a repetitive text loop and was stopped by the runtime.\n" +
  "Continue from the last useful step without repeating or restating the looped text.\n" +
  "Call the next appropriate tool, or call `finish_work` if the task is complete.\n" +
  "Do not explain. Continue with a tool call.";

export const MIXED_FINISH_WORK_REPAIR_MESSAGE =
  "Do not mix `finish_work` with other tool calls.\n" +
  "Call non-terminal tools first, or call only `finish_work` when the task is complete.\n" +
  "Do not explain. Call a tool.";

export const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
