import type { AgentMessage } from "@dst0/p-agent-core";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { truncateKeptMessages } from "../src/core/compaction/minimal-compaction.ts";

const instruction = [
  "The provider stopped because it reached its output-token limit.",
  "Continue exactly after the final completed content above.",
  "Do not repeat, summarize, restart, or apologize.",
].join("\n");

function control(pInternal: string): AgentMessage {
  return { role: "user", content: instruction, metadata: { pInternal }, timestamp: 1 };
}

const budget = { keepRecentTokens: 1, targetContextTokens: 1 };

describe("pending controller messages across compaction", () => {
  it.each(["provider_length_continuation", "completion_protocol_repair"])(
    "preserves an unanswered %s verbatim despite pressure and queued steering",
    (kind) => {
      const pending = control(kind);
      const steering: AgentMessage = { role: "user", content: "Keep the continuation concise.", timestamp: 2 };
      const result = truncateKeptMessages(
        [fauxAssistantMessage("partial", { stopReason: "length" }), pending, steering],
        budget,
      );

      expect(result[1]).toBe(pending);
      expect(result[1]).toEqual(control(kind));
      expect(result).toHaveLength(3);
      expect(result[2]).not.toEqual(steering);
    },
  );

  it("does not protect completed historical controls or ordinary user copies of the instruction", () => {
    const historical = control("provider_length_continuation");
    const ordinary: AgentMessage = { role: "user", content: instruction, timestamp: 2 };
    const unknown = control("unrecognized_control");
    const result = truncateKeptMessages([historical, fauxAssistantMessage("continued"), ordinary, unknown], budget);

    expect(result[0]).not.toEqual(historical);
    expect(result[2]).not.toEqual(ordinary);
    expect(result[3]).not.toEqual(unknown);
  });

  it("protects only the pending suffix when an earlier control was answered", () => {
    const historical = control("completion_protocol_repair");
    const pending = control("provider_length_continuation");
    const result = truncateKeptMessages(
      [historical, fauxAssistantMessage("partial", { stopReason: "length" }), pending],
      budget,
    );

    expect(result[0]).not.toEqual(historical);
    expect(result[2]).toBe(pending);
  });

  it("does not mistake a provider error for an answer to the pending continuation", () => {
    const pending = control("provider_length_continuation");
    const error = fauxAssistantMessage("", { stopReason: "error", errorMessage: "context length exceeded" });
    const result = truncateKeptMessages(
      [fauxAssistantMessage("partial", { stopReason: "length" }), pending, error],
      budget,
    );

    expect(result[1]).toBe(pending);
  });

  it("treats explicit cancellation as a terminal boundary for an earlier continuation", () => {
    const pending = control("provider_length_continuation");
    const result = truncateKeptMessages(
      [pending, fauxAssistantMessage("cancelled prefix", { stopReason: "aborted" })],
      budget,
    );

    expect(result[0]).not.toEqual(pending);
  });

  it("preserves controller content blocks and metadata without mutating the original", () => {
    const pending: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: instruction }],
      metadata: { pInternal: "completion_protocol_repair", completionProtocolRepairReason: "missing_finish" },
      timestamp: 3,
    };
    const result = truncateKeptMessages([pending], budget);

    expect(result[0]).toBe(pending);
    expect(result[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: instruction }],
      metadata: { pInternal: "completion_protocol_repair", completionProtocolRepairReason: "missing_finish" },
      timestamp: 3,
    });
  });
});
