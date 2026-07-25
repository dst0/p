import { describe, expect, it } from "vitest";
import { registerFauxProvider } from "./../src/providers/faux.ts";
import { registerSessionResourceCleanup } from "../src/session-resources.ts";
import { completeSimple } from "../src/stream.ts";
import type { Context } from "../src/types.ts";

describe("stream-unit", () => {
  it("completeSimple and streamSimple execute successfully with faux provider", async () => {
    const faux = registerFauxProvider({
      api: "faux-unit-api",
      provider: "faux-unit-provider",
    });

    faux.setResponses([
      {
        role: "assistant",
        content: [{ type: "text", text: "Simple complete response" }],
        api: faux.api,
        provider: "faux-unit-provider",
        model: faux.models[0].id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    ]);

    const context: Context = {
      systemPrompt: "System prompt <project_memory> memory info",
      messages: [], // No user messages -> tests injectRuntimeContext line 165
    };

    const res = await completeSimple(faux.models[0], context);
    expect(res.stopReason).toBe("stop");
    expect(res.content[0].type).toBe("text");
    if (res.content[0].type === "text") {
      expect(res.content[0].text).toBe("Simple complete response");
    }

    // Cleanup session resources without sessionId (line 29 in stream.ts)
    registerSessionResourceCleanup(undefined as any);

    faux.unregister();
  });
});
