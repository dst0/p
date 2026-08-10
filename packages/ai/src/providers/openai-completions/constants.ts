export const COLD_PREFILL_MIN_TOKENS = 512;
export const PREFERRED_MIN_ELAPSED_MS = 100;
export const TOOL_CALL_REPETITION_CHECK_INTERVAL_CHARS = 256;
export const OUTPUT_REPETITION_CHECK_INTERVAL_CHARS = 512;
export const TOOL_CALL_REPETITION_MESSAGE =
  "Stopped a malformed tool call after its streamed arguments entered a repetitive loop.";
export const TEXT_REPETITION_MESSAGE = "Stopped a response after its streamed text entered a repetitive loop.";
export const THINKING_REPETITION_MESSAGE = "Stopped a response after its streamed reasoning entered a repetitive loop.";
