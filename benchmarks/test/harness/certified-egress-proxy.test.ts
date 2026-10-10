import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { test } from "node:test";
import { startCertifiedEgressProxy } from "../../src/harness/certified-egress-proxy.ts";
import { hasIpv6Loopback } from "./ipv6-loopback.ts";

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

test("certified proxy forwards unchanged model requests only to its fixed upstream", async () => {
  const received: { path?: string; body?: string; authorization?: string }[] = [];
  const response = `data: ${JSON.stringify({ model, choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`;
  const upstream = createServer(async (request, reply) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({
      path: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
      authorization: request.headers.authorization,
    });
    reply.writeHead(200, { "content-type": "text/event-stream" });
    reply.end(response);
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
    apiKey: "canonical-test-key",
  });
  try {
    proxy.beginCell("run-1:p:calculator");
    const body = JSON.stringify({ model, messages: [{ role: "user", content: "Test" }], stream: true });
    const passed = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-key" },
      body,
    });
    assert.equal(passed.status, 200);
    assert.equal(await passed.text(), response);
    const evidence = proxy.endCell("run-1:p:calculator");
    assert.equal(evidence.requestCount, 1);
    assert.deepEqual(evidence.requestModels, [model]);
    assert.deepEqual(evidence.responseModels, [model]);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      path: "/v1/chat/completions",
      body,
      authorization: "Bearer canonical-test-key",
    });

    proxy.beginCell("run-1:pi:calculator");
    const rejected = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "different-model", messages: [] }),
    });
    assert.equal(rejected.status, 403);
    assert.equal(received.length, 1, "A model mismatch must never reach upstream");
    assert.throws(() => proxy.endCell("run-1:pi:calculator"), /rejected|missing/u);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test("certified proxy rejects client-selected destinations and closes its listener", async () => {
  const upstream = createServer((_request, reply) => reply.end("unexpected"));
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  const baseUrl = proxy.baseUrl;
  try {
    proxy.beginCell("probe");
    const rejected = await fetch(`${baseUrl}/chat/completions?target=http://example.test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    assert.equal(rejected.status, 403);
    assert.throws(() => proxy.endCell("probe"), /rejected|missing/u);
  } finally {
    await proxy.close();
    await close(upstream);
  }
  await assert.rejects(fetch(`${baseUrl}/models`));
});

test("a held request body cannot escape the cell evidence boundary", async () => {
  let forwarded = 0;
  const upstream = createServer((_request, reply) => {
    forwarded += 1;
    reply.writeHead(200, { "content-type": "text/event-stream" });
    reply.end(`data: ${JSON.stringify({ model })}\n\n`);
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  try {
    let announceHeld: (() => void) | undefined;
    const heldAccepted = new Promise<void>((resolve) => {
      announceHeld = resolve;
    });
    const originalHandle = proxy.handle.bind(proxy);
    proxy.handle = (request, reply) => {
      originalHandle(request, reply);
      if (request.headers["x-held-test"] === "1") announceHeld?.();
    };
    proxy.beginCell("held-body");
    const fullBody = JSON.stringify({ model, messages: [] });
    const url = new URL(`${proxy.baseUrl}/chat/completions`);
    const held = httpRequest(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(fullBody)),
        "x-held-test": "1",
      },
    });
    const heldFinished = new Promise<number>((resolve, reject) => {
      held.once("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
        response.once("error", reject);
      });
      held.once("error", reject);
    });
    void heldFinished.catch(() => undefined);
    held.write(fullBody.slice(0, 1));
    await heldAccepted;
    const normal = await fetch(url, { method: "POST", body: fullBody });
    assert.equal(normal.status, 200);
    await normal.text();
    assert.throws(() => proxy.endCell("held-body"), /pending/u);
    held.end(fullBody.slice(1));
    assert.equal(await heldFinished, 403);
    assert.equal(forwarded, 1, "The held request must not reach upstream after the cell ends");
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test("every forwarded completion needs its own successful model-bearing response", async () => {
  let count = 0;
  const upstream = createServer((_request, reply) => {
    count += 1;
    reply.writeHead(200, { "content-type": "text/event-stream" });
    reply.end(count === 1 ? `data: ${JSON.stringify({ model })}\n\n` : "data: [DONE]\n\n");
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  try {
    proxy.beginCell("two-responses");
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model, messages: [] }),
      });
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.throws(() => proxy.endCell("two-responses"), /response model evidence/u);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test("closing the proxy aborts and settles a stalled upstream completion", async () => {
  let announceRequest: (() => void) | undefined;
  const requestSeen = new Promise<void>((resolve) => {
    announceRequest = resolve;
  });
  let upstreamClosed = false;
  let announceClose: (() => void) | undefined;
  const upstreamTerminated = new Promise<void>((resolve) => {
    announceClose = resolve;
  });
  const upstream = createServer((_request, reply) => {
    reply.once("close", () => {
      upstreamClosed = true;
      announceClose?.();
    });
    announceRequest?.();
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  const client = new AbortController();
  try {
    proxy.beginCell("stalled-upstream");
    const pending = fetch(`${proxy.baseUrl}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model, messages: [] }),
      signal: client.signal,
    }).catch(() => undefined);
    await requestSeen;
    await proxy.close();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        upstreamTerminated,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Upstream did not close")), 1000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    assert.equal(upstreamClosed, true, "Remote peer must observe the aborted upstream request");
    await pending;
  } finally {
    client.abort();
    await proxy.close();
    await close(upstream);
  }
});

test("IPv6 loopback carries a streamed SSE response with the expected model", async (context) => {
  if (!(await hasIpv6Loopback())) return context.skip("IPv6 loopback is unavailable on this host");
  const upstream = createServer((_request, reply) => {
    reply.writeHead(200, { "content-type": "text/event-stream" });
    reply.write('data: {"mod');
    setImmediate(() => reply.end(`el":${JSON.stringify(model)}}\n\ndata: [DONE]\n\n`));
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  try {
    proxy.beginCell("ipv6-split-sse");
    const response = await fetch(`${proxy.baseUrl.replace(/localhost|127\.0\.0\.1/u, "[::1]")}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.deepEqual(proxy.endCell("ipv6-split-sse").responseModels, [model]);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});
