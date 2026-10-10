import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { startCertifiedEgressProxy } from "../../src/harness/certified-egress-proxy.ts";

const model = "mini-pc/sokann-qwen-27b-cache";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("without a canonical key, incoming authorization never reaches upstream", async () => {
  let observedAuthorization: string | undefined;
  let observedCustomCredential: string | undefined;
  const upstream = createServer((request, reply) => {
    observedAuthorization = request.headers.authorization;
    observedCustomCredential = request.headers["x-private-token"] as string | undefined;
    reply.writeHead(200, { "content-type": "text/event-stream" });
    reply.end(`data: ${JSON.stringify({ model })}\n\n`);
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  try {
    proxy.beginCell("no-key");
    const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer candidate-secret", "x-private-token": "candidate-secret" },
      body: JSON.stringify({ model, messages: [] }),
    });
    await response.text();
    assert.equal(response.status, 200);
    proxy.endCell("no-key");
    assert.equal(observedAuthorization, undefined);
    assert.equal(observedCustomCredential, undefined);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test("redirects and encoded API paths cannot produce certified evidence", async () => {
  let hits = 0;
  const upstream = createServer((_request, reply) => {
    hits += 1;
    reply.writeHead(307, { location: "https://unrelated.example.test/v1/chat/completions" });
    reply.end();
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  try {
    proxy.beginCell("invalid-targets");
    const encoded = await fetch(`${proxy.baseUrl}/chat/%63ompletions`, {
      method: "POST",
      body: JSON.stringify({ model }),
    });
    assert.equal(encoded.status, 403);
    assert.equal(hits, 0);
    const redirected = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model }),
    });
    assert.equal(redirected.status, 502);
    assert.equal(hits, 1);
    assert.throws(() => proxy.endCell("invalid-targets"), /rejected|response model/u);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test("unsafe direct upstream options are rejected before proxy startup", async () => {
  for (const upstreamBaseUrl of [
    "http://example.invalid/v1",
    "http://user:password@127.0.0.1/v1",
    "http://127.0.0.1/v1?token=hidden",
    "http://127.0.0.1/v1#fragment",
  ]) {
    await assert.rejects(
      startCertifiedEgressProxy({ upstreamBaseUrl, expectedModel: model }),
      /Invalid certified proxy upstream configuration/u,
    );
  }
  await assert.rejects(
    startCertifiedEgressProxy({ upstreamBaseUrl: "http://127.0.0.1/v1", expectedModel: "" }),
    /Invalid certified proxy upstream configuration/u,
  );
});
