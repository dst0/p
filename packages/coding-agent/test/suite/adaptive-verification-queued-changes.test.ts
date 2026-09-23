import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { BEGIN_CODE_TASK_TOOL_NAME } from "../../src/core/tools/begin-code-task.ts";
import {
  type AdaptiveHarness,
  createAdaptiveHarness,
  tools,
  writeWorkspaceFile,
} from "./adaptive-verification-fixture.ts";

describe("adaptive verification: changes queued during a run", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  async function setup(): Promise<AdaptiveHarness> {
    const adaptive = await createAdaptiveHarness();
    harnesses.push(adaptive);
    writeWorkspaceFile(adaptive.harness.tempDir, "src/range.js", "export const range = (n) => n;\n");
    return adaptive;
  }

  it("escalates for a steering message that asks for a code change before answering it", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;
    adaptive.respond((request) => {
      void session.steer("Fix the off-by-one bug in src/range.js");
      expect(request.toolNames).toContain(BEGIN_CODE_TASK_TOOL_NAME);
      return tools(fauxToolCall("read", { path: "src/range.js" }));
    }, fauxAssistantMessage("Which input shows the off-by-one?"));

    await session.prompt("Read src/range.js.");

    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.requests[1]?.toolNames).toEqual(
      expect.arrayContaining(["record_task_verification", "finish_work"]),
    );
    expect(adaptive.requests[1]?.messageTexts).toContain("Fix the off-by-one bug in src/range.js");
    expect(session.getVerificationTierStatus()).toMatchObject({ tier: "strict", reason: "prior" });
  });

  it("queues a policy override requested mid-run until the next turn boundary", async () => {
    const adaptive = await setup();
    const session = adaptive.harness.session;
    let midRunStatus: ReturnType<typeof session.setVerificationPolicy>;
    adaptive.respond(
      () => {
        midRunStatus = session.setVerificationPolicy("strict");
        return tools(fauxToolCall("read", { path: "src/range.js" }));
      },
      tools(
        fauxToolCall("finish_work", {
          status: "partial",
          summary: "range returns its input.",
          remaining_work: ["Confirm the expected range behavior"],
        }),
      ),
    );

    await session.prompt("Read src/range.js.");

    expect(adaptive.requests).toHaveLength(2);
    expect(adaptive.harness.getPendingResponseCount()).toBe(0);
    expect(midRunStatus).toMatchObject({ policy: "auto", tier: "light", pendingPolicy: "strict" });
    expect(adaptive.requests[0]?.toolNames).not.toContain("finish_work");
    expect(adaptive.requests[1]?.toolNames).toEqual(
      expect.arrayContaining(["record_task_verification", "finish_work"]),
    );
    expect(session.getVerificationTierStatus()).toMatchObject({ policy: "strict", tier: "strict" });
    expect(session.getVerificationTierStatus()?.pendingPolicy).toBeUndefined();
  });
});
