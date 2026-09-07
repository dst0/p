import { afterEach, describe, expect, it, vi } from "vitest";
import { registerApiProvider, unregisterApiProviders } from "../src/api-registry.ts";
import { registerModelCallGuard } from "../src/model-call-guard.ts";
import { complete, completeSimple, streamSimple } from "../src/stream.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import { createAssistantMessageEventStream } from "../src/utils/event-stream.ts";

const model: Model<"admission-test"> = {
  id: "model",
  name: "model",
  api: "admission-test",
  provider: "admission-test",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};
const message: AssistantMessage = {
  role: "assistant",
  api: model.api,
  provider: model.provider,
  model: model.id,
  content: [{ type: "text", text: "Completed requested operation" }],
  stopReason: "stop",
  timestamp: 0,
  usage: {
    input: 3,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 5,
    cost: { input: 0.000003, output: 0.000004, cacheRead: 0, cacheWrite: 0, total: 0.000007 },
  },
};
let removeGuard: (() => void) | undefined;
afterEach(() => {
  removeGuard?.();
  removeGuard = undefined;
  unregisterApiProviders("admission-test");
});

describe("public model-call admission", () => {
  it("settles a provider result even when the provider closes without a terminal event", async () => {
    const settle = vi.fn();
    const dispatch = () => {
      const source = createAssistantMessageEventStream();
      source.end(message);
      return source;
    };
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(() => ({ settle }));
    expect(await completeSimple(model, { messages: [] })).toEqual(message);
    expect(settle).toHaveBeenCalledExactlyOnceWith(message.usage);
  });

  it.each(["dispatch", "iterator"] as const)(
    "reports uncertain accounting if receipt persistence also fails after %s failure",
    async (stage) => {
      const settle = vi.fn(() => {
        throw new Error("budget_storage_error: unresolved provider receipt");
      });
      const dispatch = () => {
        if (stage === "dispatch") throw new Error("Transport initialization failed");
        const source = createAssistantMessageEventStream();
        vi.spyOn(source, Symbol.asyncIterator).mockImplementation(async function* () {
          yield { type: "text_delta", contentIndex: 0, delta: "Completed", partial: message };
          throw new Error("Transport disconnected");
        });
        return source;
      };
      registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
      removeGuard = registerModelCallGuard(() => ({ settle }));
      const result = await completeSimple(model, { messages: [] });
      expect(result.errorMessage).toMatch(/^budget_storage_error:/);
      if (stage === "iterator") expect(result.content).toEqual(message.content);
      expect(settle).toHaveBeenCalledExactlyOnceWith(undefined);
    },
  );
  it.each(["dispatch", "iterator"] as const)("preserves an in-flight abort from the provider %s", async (stage) => {
    const controller = new AbortController();
    const settle = vi.fn();
    const dispatch = () => {
      const abort = () => {
        controller.abort();
        throw new DOMException("Operation cancelled", "AbortError");
      };
      if (stage === "dispatch") return abort();
      const source = createAssistantMessageEventStream();
      vi.spyOn(source, Symbol.asyncIterator).mockImplementation(async function* () {
        yield { type: "text_delta", contentIndex: 0, delta: "Completed", partial: message };
        abort();
      });
      return source;
    };
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(() => ({ settle }));
    const result = await completeSimple(model, { messages: [] }, { signal: controller.signal });
    expect(result.stopReason).toBe("aborted");
    if (stage === "iterator") expect(result.content).toEqual(message.content);
    expect(settle).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it("retains actual output when saving the final spend receipt fails", async () => {
    const dispatch = () => {
      const source = createAssistantMessageEventStream();
      source.push({ type: "done", reason: "stop", message });
      source.end();
      return source;
    };
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(() => ({
      settle: () => {
        throw new Error("budget_storage_error: receipt not saved");
      },
    }));
    const result = await completeSimple(model, { messages: [] });
    expect(result).toMatchObject({ content: message.content, usage: message.usage, stopReason: "error" });
    expect(result.errorMessage).toMatch(/^budget_storage_error:/);
  });
  it.each([complete, completeSimple])(
    "settles before result-only completion and never reads a stream twice",
    async (run) => {
      const settle = vi.fn();
      const dispatch = vi.fn(() => {
        const source = createAssistantMessageEventStream();
        source.push({ type: "text_delta", contentIndex: 0, delta: "Completed", partial: message });
        source.push({ type: "done", reason: "stop", message });
        source.end();
        return source;
      });
      registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
      removeGuard = registerModelCallGuard(() => ({ settle }));
      expect(await run(model, { messages: [] })).toEqual(message);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledExactlyOnceWith(message.usage);
    },
  );

  it("denies the next call without dispatching and encodes one terminal error", async () => {
    const dispatch = vi.fn();
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(() => {
      throw new Error("budget_exhausted: request allowance consumed");
    });
    const source = streamSimple(model, { messages: [] });
    const events = [];
    for await (const event of source) events.push(event);
    expect(dispatch).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect((await source.result()).errorMessage).toMatch(/^budget_exhausted:/);
  });

  it("does not admit a pre-aborted operation", async () => {
    const guard = vi.fn();
    const dispatch = vi.fn();
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(guard);
    const result = await completeSimple(model, { messages: [] }, { signal: AbortSignal.abort() });
    expect(result.stopReason).toBe("aborted");
    expect(guard).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("settles an admitted synchronous failure as unknown exactly once", async () => {
    const settle = vi.fn();
    const dispatch = () => {
      throw new Error("transport failed before usage");
    };
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(() => ({ settle }));
    const result = await completeSimple(model, { messages: [] });
    expect(result.stopReason).toBe("error");
    expect(settle).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("preserves streamed deltas and settles before the terminal event", async () => {
    let settled = false;
    const dispatch = () => {
      const source = createAssistantMessageEventStream();
      queueMicrotask(() => {
        source.push({ type: "text_delta", contentIndex: 0, delta: "Completed", partial: message });
        source.push({ type: "done", reason: "stop", message });
        source.end();
      });
      return source;
    };
    registerApiProvider({ api: model.api, stream: dispatch, streamSimple: dispatch }, "admission-test");
    removeGuard = registerModelCallGuard(() => ({
      settle: () => {
        settled = true;
      },
    }));
    const events = [];
    for await (const event of streamSimple(model, { messages: [] })) {
      events.push(event.type);
      if (event.type === "done") expect(settled).toBe(true);
    }
    expect(events).toEqual(["text_delta", "done"]);
  });
});
