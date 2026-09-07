import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePRecording } from "../../src/harness/p-recording.ts";

test("records the response model emitted by normal P assistant messages", () => {
  const metrics = parsePRecording(
    [
      {
        type: "message_end",
        message: {
          role: "assistant",
          model: "backend/model-from-message",
          stopReason: "toolUse",
          content: [],
          usage: {},
        },
      },
    ],
    () => "",
  );

  assert.equal(metrics.responseModel, "backend/model-from-message");
});
