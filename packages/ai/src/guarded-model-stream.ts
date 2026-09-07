import { admitModelCall, type ModelCallReceipt } from "./model-call-guard.ts";
import type { Api, AssistantMessage, Model } from "./types.ts";
import { type AssistantMessageEventStream, createAssistantMessageEventStream } from "./utils/event-stream.ts";

export function guardedModelStream(
  model: Model<Api>,
  signal: AbortSignal | undefined,
  dispatch: () => AssistantMessageEventStream,
): AssistantMessageEventStream {
  let receipt: ModelCallReceipt | undefined;
  let settled = false;
  let latest: AssistantMessage | undefined;
  const output = createAssistantMessageEventStream();
  const fail = (error: unknown, aborted = false) => {
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: latest?.content ?? [],
      stopReason: aborted ? "aborted" : "error",
      timestamp: Date.now(),
      errorMessage: error instanceof Error ? error.message : "Model-call admission failed",
      usage: latest?.usage ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    output.push({ type: "error", reason: aborted ? "aborted" : "error", error: message });
    output.end();
  };
  try {
    if (signal?.aborted) {
      fail(new Error("Operation aborted"), true);
      return output;
    }
    receipt = admitModelCall({ kind: "text", model, signal });
    const source = dispatch();
    if (!receipt) return source;
    const admittedReceipt = receipt;
    void (async () => {
      try {
        for await (const event of source) {
          latest = event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial;
          if (event.type === "done" || event.type === "error") {
            settled = true;
            admittedReceipt.settle(event.type === "done" ? event.message.usage : event.error.usage);
          }
          output.push(event);
        }
        const result = await source.result();
        latest = result;
        if (!settled) {
          settled = true;
          admittedReceipt.settle(result.usage);
        }
        output.end(result);
      } catch (error) {
        let failure = error;
        if (!settled) {
          settled = true;
          try {
            admittedReceipt.settle(undefined);
          } catch (settlementError) {
            failure = settlementError;
          }
        }
        fail(failure, signal?.aborted);
      }
    })();
  } catch (error) {
    let failure = error;
    if (receipt && !settled) {
      settled = true;
      try {
        receipt.settle(undefined);
      } catch (settlementError) {
        failure = settlementError;
      }
    }
    fail(failure, signal?.aborted);
  }
  return output;
}
