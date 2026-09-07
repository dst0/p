import { describe, expect, it } from "vitest";
import { PendingMessageQueue } from "../src/agent/pendingmessagequeue.ts";
import type { AgentMessage } from "../src/types.ts";

function user(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() };
}

describe("PendingMessageQueue groups", () => {
  it("keeps an atomic message group together in one-at-a-time mode", () => {
    const queue = new PendingMessageQueue("one-at-a-time");
    const first = user("first");
    const context = user("hidden context");
    const second = user("second");

    queue.enqueueGroup([first, context]);
    queue.enqueueGroup([second]);

    expect(queue.drain()).toEqual([first, context]);
    expect(queue.drain()).toEqual([second]);
    expect(queue.drain()).toEqual([]);
  });

  it("flattens every complete group in all mode", () => {
    const queue = new PendingMessageQueue("all");
    const first = user("first");
    const context = user("hidden context");
    const second = user("second");

    queue.enqueueGroup([first, context]);
    queue.enqueueGroup([second]);

    expect(queue.drain()).toEqual([first, context, second]);
    expect(queue.hasItems()).toBe(false);
  });
});
