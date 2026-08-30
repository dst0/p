import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { generateImagesOpenAI } from "../src/providers/images/openai.ts";
import type { ImagesModel } from "../src/types.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

describe("llm-orchestrator image generation contract", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("posts the canonical OpenAI-compatible request and accepts base64 image data", async () => {
    let received:
      | {
          method?: string;
          url?: string;
          authorization?: string;
          body: Record<string, unknown>;
        }
      | undefined;
    const server = createServer(async (request, response) => {
      received = {
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: await readJsonBody(request),
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ created: 1, data: [{ b64_json: PNG_BASE64 }] }));
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const model: ImagesModel<"openai-images"> = {
      id: "flux2-klein-4b",
      name: "LLM Orchestrator: FLUX.2 Klein 4B",
      api: "openai-images",
      provider: "llm-orchestrator",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      input: ["text"],
      output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };

    const result = await generateImagesOpenAI(
      model,
      { input: [{ type: "text", text: "A brass compass" }] },
      {
        apiKey: "orchestrator-secret",
        size: "1234x567",
      },
    );

    expect(result.stopReason).toBe("stop");
    expect(result.output[0]).toEqual({ type: "image", mimeType: "image/png", data: PNG_BASE64 });
    expect(received).toEqual({
      method: "POST",
      url: "/v1/images/generations",
      authorization: "Bearer orchestrator-secret",
      body: {
        model: "flux2-klein-4b",
        prompt: "A brass compass",
        n: 1,
        response_format: "b64_json",
        size: "1234x567",
      },
    });
  });
});
