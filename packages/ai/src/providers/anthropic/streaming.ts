import type Anthropic from "@anthropic-ai/sdk";
import type { RefusalStopDetails } from "@anthropic-ai/sdk/resources/messages.js";
import type { StopReason } from "../../types.ts";

export function mapStopReason(
  reason: Anthropic.Messages.StopReason | string,
  stopDetails?: RefusalStopDetails | null,
): { stopReason: StopReason; errorMessage?: string } {
  switch (reason) {
    case "end_turn":
      return { stopReason: "stop" };
    case "max_tokens":
      return { stopReason: "length" };
    case "tool_use":
      return { stopReason: "toolUse" };
    case "refusal":
      return {
        stopReason: "error",
        errorMessage: stopDetails?.explanation || `The model refused to complete the request`,
      };
    case "pause_turn": // Stop is good enough -> resubmit
      return { stopReason: "stop" };
    case "stop_sequence":
      return { stopReason: "stop" }; // We don't supply stop sequences, so this should never happen
    case "sensitive": // Content flagged by safety filters (not yet in SDK types)
      return { stopReason: "error" };
    default:
      // Handle unknown stop reasons gracefully (API may add new values)
      throw new Error(`Unhandled stop reason: ${reason}`);
  }
}
