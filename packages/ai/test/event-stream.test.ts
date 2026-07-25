import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import {
  AssistantMessageEventStream,
  createAssistantMessageEventStream,
  EventStream,
} from "../src/utils/event-stream.ts";

describe("event-stream", () => {
  it("notifies waiting consumers when end() is called", async () => {
    const stream = new EventStream<string, string>(
      (event) => event === "done",
      (event) => event,
    );

    const iterator = stream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();

    stream.end("final");
    const result = await nextPromise;
    expect(result.done).toBe(true);
    expect(await stream.result()).toBe("final");
  });

  it("handles AssistantMessageEventStream error event and factory", async () => {
    const stream = createAssistantMessageEventStream();
    expect(stream).toBeInstanceOf(AssistantMessageEventStream);

    const errMessage: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "Test error",
      timestamp: 0,
    };

    stream.push({ type: "error", reason: "error", error: errMessage });
    const res = await stream.result();
    expect(res).toBe(errMessage);
  });
});
