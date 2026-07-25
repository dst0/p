import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamBedrock, streamSimpleBedrock } from "../src/providers/amazon-bedrock.ts";
import type { Context, Model } from "../src/types.ts";

const mockSend = vi.fn();
const mockMiddlewareStackAdd = vi.fn();

vi.mock("@aws-sdk/client-bedrock-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-bedrock-runtime")>();
  return {
    ...actual,
    BedrockRuntimeClient: vi.fn().mockImplementation(function (
      this: { config?: unknown; middlewareStack?: unknown; send?: unknown },
      config: unknown,
    ) {
      this.config = config;
      this.middlewareStack = { add: mockMiddlewareStackAdd };
      this.send = mockSend;
    }),
    ConverseStreamCommand: vi.fn().mockImplementation(function (this: { input?: unknown }, input: unknown) {
      this.input = input;
    }),
  };
});

describe("amazon-bedrock comprehensive coverage", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.AWS_BEDROCK_SKIP_AUTH;
    delete process.env.AWS_BEDROCK_FORCE_HTTP1;
    delete process.env.P_CACHE_RETENTION;
    delete process.env.AWS_BEDROCK_FORCE_CACHE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  const claudeModel: Model<"bedrock-converse-stream"> = {
    id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    name: "Claude 3.7 Sonnet",
    api: "bedrock-converse-stream",
    provider: "amazon-bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 4096,
  };

  it("handles full ConverseStream event sequence with text, thinking, and tool use", async () => {
    async function* asyncStream() {
      yield { messageStart: { role: "assistant" } };
      yield {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: "tool-1", name: "calculator" } },
        },
      };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"a": 1' } },
        },
      };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: ', "b": 2}' } },
        },
      };
      yield { contentBlockStop: { contentBlockIndex: 0 } };
      yield { contentBlockDelta: { contentBlockIndex: 1, delta: { text: "Hello " } } };
      yield { contentBlockDelta: { contentBlockIndex: 1, delta: { text: "world" } } };
      yield { contentBlockStop: { contentBlockIndex: 1 } };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 2,
          delta: { reasoningContent: { text: "Thinking details", signature: "sig-xyz" } },
        },
      };
      yield { contentBlockStop: { contentBlockIndex: 2 } };
      yield { messageStop: { stopReason: "tool_use" } };
      yield {
        metadata: {
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 10,
            cacheWriteInputTokens: 20,
            totalTokens: 180,
          },
        },
      };
    }

    mockSend.mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200, requestId: "req-123" },
      stream: asyncStream(),
    });

    const onPayload = vi.fn((p) => p);
    const onResponse = vi.fn();

    const context: Context = {
      systemPrompt: "Be helpful",
      tools: [
        {
          name: "calculator",
          description: "calc",
          parameters: { type: "object", properties: { a: { type: "number" } } },
        },
      ],
      messages: [{ role: "user", content: "Calculate 1+2", timestamp: 0 }],
    };

    const stream = streamBedrock(claudeModel, context, {
      region: "us-west-2",
      headers: { "x-custom-header": "test", authorization: "should-be-ignored" },
      onPayload,
      onResponse,
      toolChoice: "auto",
      reasoning: "high",
    });

    const events: { type: string }[] = [];
    (async () => {
      for await (const evt of stream) {
        events.push(evt as { type: string });
      }
    })();

    const res = await stream.result();

    expect(res.stopReason).toBe("toolUse");
    expect(res.usage.input).toBe(100);
    expect(res.usage.output).toBe(50);
    expect(res.usage.cacheRead).toBe(10);
    expect(res.usage.cacheWrite).toBe(20);
    expect(onPayload).toHaveBeenCalled();
    expect(onResponse).toHaveBeenCalledWith({ status: 200, headers: { "x-amzn-requestid": "req-123" } }, claudeModel);
    expect(events.some((e) => e.type === "toolcall_start")).toBe(true);
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "thinking_delta")).toBe(true);
  });

  it("handles custom middleware header injection", async () => {
    async function* asyncStream() {
      yield { messageStop: { stopReason: "end_turn" } };
    }

    mockSend.mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200 },
      stream: asyncStream(),
    });

    const context: Context = { messages: [] };
    const stream = streamBedrock(claudeModel, context, {
      headers: { "X-Custom": "val", "x-amz-security-token": "ignore" },
    });

    await stream.result();

    expect(mockMiddlewareStackAdd).toHaveBeenCalled();
    const middlewareFn = mockMiddlewareStackAdd.mock.calls[0][0];
    const nextFn = vi.fn().mockResolvedValue("done");
    const fakeRequest = { headers: {} as Record<string, string> };
    await middlewareFn(nextFn)({ request: fakeRequest });

    expect(fakeRequest.headers["X-Custom"]).toBe("val");
    expect(fakeRequest.headers["x-amz-security-token"]).toBeUndefined();
  });

  it("handles consecutive toolResult messages and image format conversion", async () => {
    async function* asyncStream() {
      yield { messageStop: { stopReason: "end_turn" } };
    }
    mockSend.mockResolvedValueOnce({
      $metadata: {},
      stream: asyncStream(),
    });

    const context: Context = {
      messages: [
        {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "t1",
          content: [
            { type: "text", text: "result 1" },
            { type: "image", mimeType: "image/jpeg", data: "YmFzZTY0" },
            { type: "image", mimeType: "image/png", data: "YmFzZTY0" },
            { type: "image", mimeType: "image/gif", data: "YmFzZTY0" },
            { type: "image", mimeType: "image/webp", data: "YmFzZTY0" },
          ],
          isError: false,
          timestamp: 0,
        },
        {
          role: "toolResult",
          toolCallId: "call_2",
          toolName: "t2",
          content: [{ type: "text", text: "result 2" }],
          isError: true,
          timestamp: 0,
        },
      ],
    };

    const stream = streamBedrock(claudeModel, context, { cacheRetention: "long" });
    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });

  it("handles unknown image mimeType error in message conversion", async () => {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: [{ type: "image", mimeType: "image/bmp", data: "YmFzZTY0" }],
          timestamp: 0,
        },
      ],
    };

    const stream = streamBedrock(claudeModel, context);
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Unknown image type: image/bmp");
  });

  it("handles stream exceptions like validationException and internalServerException", async () => {
    async function* asyncStream() {
      yield { validationException: new Error("Invalid request payload") };
    }

    mockSend.mockResolvedValueOnce({
      $metadata: {},
      stream: asyncStream(),
    });

    const context: Context = { messages: [] };
    const stream = streamBedrock(claudeModel, context);
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Invalid request payload");
  });

  it("handles data retention error hint formatting", async () => {
    async function* asyncStream() {
      yield { validationException: new Error("Data retention mode 'default' is not available for this model") };
    }

    mockSend.mockResolvedValueOnce({
      $metadata: {},
      stream: asyncStream(),
    });

    const context: Context = { messages: [] };
    const stream = streamBedrock(claudeModel, context);
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("See https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html");
  });

  it("handles ARN region parsing and skip auth environment options", async () => {
    process.env.AWS_BEDROCK_SKIP_AUTH = "1";
    process.env.AWS_BEDROCK_FORCE_HTTP1 = "1";

    async function* asyncStream() {
      yield { messageStop: { stopReason: "stop_sequence" } };
    }
    mockSend.mockResolvedValueOnce({ $metadata: {}, stream: asyncStream() });

    const arnModel: Model<"bedrock-converse-stream"> = {
      ...claudeModel,
      id: "arn:aws:bedrock:eu-west-1:123456789012:inference-profile/us.anthropic.claude-3-7-sonnet",
    };

    const context: Context = { messages: [] };
    const stream = streamBedrock(arnModel, context);
    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });

  it("handles adaptive thinking and simple bedrock stream mapping", async () => {
    async function* asyncStream() {
      yield { messageStop: { stopReason: "max_tokens" } };
    }
    mockSend.mockResolvedValueOnce({ $metadata: {}, stream: asyncStream() });

    const adaptiveModel: Model<"bedrock-converse-stream"> = {
      ...claudeModel,
      id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
      name: "Sonnet 4.6",
    };

    const context: Context = { messages: [] };
    const stream = streamSimpleBedrock(adaptiveModel, context, {
      reasoning: "xhigh",
    });
    const res = await stream.result();
    expect(res.stopReason).toBe("length");
  });

  it("handles GovCloud Bedrock target detection and thinking display option", async () => {
    async function* asyncStream() {
      yield { messageStop: { stopReason: "end_turn" } };
    }
    mockSend.mockResolvedValueOnce({ $metadata: {}, stream: asyncStream() });

    const govModel: Model<"bedrock-converse-stream"> = {
      ...claudeModel,
      id: "us-gov.anthropic.claude-3-5-sonnet",
    };

    const context: Context = { messages: [] };
    const stream = streamBedrock(govModel, context, {
      reasoning: "high",
      thinkingDisplay: "omitted",
      requestMetadata: { project: "unit-test" },
    });
    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });

  it("handles toolChoice variants (any, tool, none)", async () => {
    async function* asyncStream() {
      yield { messageStop: { stopReason: "end_turn" } };
    }
    mockSend.mockResolvedValueOnce({ $metadata: {}, stream: asyncStream() });

    const context: Context = {
      tools: [{ name: "foo", description: "d", parameters: {} }],
      messages: [],
    };

    const stream = streamBedrock(claudeModel, context, {
      toolChoice: { type: "tool", name: "foo" },
    });
    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });
});
