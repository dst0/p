import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
} from "./task-verification-evidence-test-harness.ts";

describe("response-only full-prompt tail gate", () => {
  it.each([
    "Write the answer in your response: after sending the approval message.",
    "Write the answer in your response, after sending the approval message.",
    "Write the answer in your response; once you have sent the approval message.",
    "Write the answer in your response — after the approval message is sent.",
    "Write the answer in your response. After sending the approval message.",
    "Write the answer in your response, but first send the approval message.",
    "Read the preceding brief, then write the answer in your response after sending the approval message.",
    "Explain the behavior, then write the answer in your response after sending the approval message.",
    "Answer in your response after sending the approval message.",
    "Give me the answer in your response after sending the approval message.",
    "Report the result in your response after sending the approval message.",
    "Answer after sending the approval message.",
    "Tell me once you have sent the approval message.",
    "Report back after creating GUIDE.md.",
    "Give me two bullets, but first create GUIDE.md.",
    "Show me the result after you update the configuration.",
    "Answer, but first send the approval message.",
    "Tell me what happens, but first create GUIDE.md.",
    "Explain how it works, but first send the approval message.",
    "Show me when it runs, but first update the configuration.",
    "Tell me as soon as you have sent the approval message.",
    "Give me two bullets following creation of GUIDE.md.",
    "Tell me once you've sent the approval message.",
    "Tell me once you’ve sent the approval message.",
    "Tell me as soon as you've sent the approval message.",
    "Show me the result when you're done updating the configuration.",
    "Report back after the approval message is sent.",
    "What happens, but first create GUIDE.md.",
    "How does it work, but first send the approval message.",
    "What happens? First create GUIDE.md.",
    "What happens: first create GUIDE.md.",
    "How does it work; first send the approval message.",
    "What happens? Please first create GUIDE.md.",
    "What happens? First please create GUIDE.md.",
    "What happens, and first create GUIDE.md.",
    "What happens — first create GUIDE.md.",
    "What happens – first create GUIDE.md.",
    "What happens?\n- First create GUIDE.md.",
    "Tell me once you finish sending the approval message.",
    "Report back after you complete creating GUIDE.md.",
    "Show me the result when you’re finished updating the configuration.",
    "Report back after the approval message has been successfully sent.",
    "Tell me once you have successfully sent the approval message.",
    "Tell me once you’ve successfully sent the approval message.",
    "Report back after you successfully create GUIDE.md.",
    "Show me the result when you actually update the configuration.",
    "Tell me after successfully sending the approval message.",
    "Report back once you are completely done updating the configuration.",
  ])("requires independent intent for an unclassified suffix: %s", async (prompt) => {
    const cwd = mkdtempSync(join(tmpdir(), "p-response-tail-gate-"));
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({ type: "message_end", message: { role: "user", content: prompt, timestamp: 100 } });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["The requested answer and any required operation are complete"],
          verification_scope: "response_only",
        }),
      ).toContain("Completion checklist recorded");

      const finish = await beforeEvidenceTool(harness.agent, "finish_work", { status: "success" });

      expect(finish?.block).toBe(true);
      expect(finish?.reason).toContain('"action":"declare_task"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
