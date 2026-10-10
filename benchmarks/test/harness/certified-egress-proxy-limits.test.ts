import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
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

async function receiveOversizedRequestStatus(url: string): Promise<number> {
  const target = new URL(url);
  const socket = connect(Number(target.port), "127.0.0.1");
  try {
    await once(socket, "connect");
    const status = new Promise<number>((resolve, reject) => {
      let response = "";
      const timeout = setTimeout(() => reject(new Error("Proxy did not reject oversized Content-Length")), 750);
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("ascii");
        const match = /^HTTP\/1\.1 (\d{3})/u.exec(response);
        if (!match) return;
        clearTimeout(timeout);
        resolve(Number(match[1]));
      });
    });
    socket.write(
      [
        "POST /v1/chat/completions HTTP/1.1",
        "Host: localhost",
        "Content-Type: application/json",
        `Content-Length: ${16 * 1024 * 1024 + 1}`,
        "",
        "",
      ].join("\r\n"),
    );
    return await status;
  } finally {
    socket.destroy();
  }
}

async function within<T>(promise: Promise<T>, message: string, timeoutMillis = 750): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMillis);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function completionBody(bytes: number): string {
  const prefix = `{"model":${JSON.stringify(model)},"messages":[{"role":"user","content":"`;
  const suffix = `"}]}`;
  return `${prefix}${"x".repeat(bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
}

async function openPartialRequest(url: string, body: string): Promise<Socket> {
  const target = new URL(url);
  const socket = connect(Number(target.port), "127.0.0.1");
  await once(socket, "connect");
  socket.write(
    [
      "POST /v1/chat/completions HTTP/1.1",
      "Host: localhost",
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body.slice(0, 1),
    ].join("\r\n"),
  );
  return socket;
}

test("certified proxy rejects oversized declared bodies before reading them", async () => {
  let upstreamRequests = 0;
  const upstream = createServer((_request, reply) => {
    upstreamRequests += 1;
    reply.end("unexpected");
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  try {
    proxy.beginCell("oversized-content-length");
    assert.equal(await receiveOversizedRequestStatus(`${proxy.baseUrl}/chat/completions`), 403);
    assert.equal(upstreamRequests, 0);
    assert.throws(() => proxy.endCell("oversized-content-length"), /rejected|missing/u);
  } finally {
    await proxy.close();
    await close(upstream);
  }
});

test("certified proxy rejects requests beyond its active forwarding limit", async () => {
  let upstreamRequests = 0;
  let announceFourRequests: (() => void) | undefined;
  const fourRequests = new Promise<void>((resolve) => {
    announceFourRequests = resolve;
  });
  const upstream = createServer(() => {
    upstreamRequests += 1;
    if (upstreamRequests === 4) announceFourRequests?.();
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  const body = JSON.stringify({ model, messages: [] });
  let held: Promise<Response | undefined>[] = [];
  try {
    proxy.beginCell("active-request-limit");
    held = Array.from({ length: 4 }, () =>
      fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST", body }).catch(() => undefined),
    );
    await within(fourRequests, "Proxy did not forward the admitted requests");
    const rejected = await within(
      fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST", body }),
      "Proxy did not enforce its active forwarding limit",
    );
    assert.equal(rejected.status, 403);
    await rejected.text();
    assert.equal(upstreamRequests, 4);
    assert.throws(() => proxy.endCell("active-request-limit"), /pending|rejected/u);
  } finally {
    await proxy.close();
    await Promise.all(held);
    await close(upstream);
  }
});

test("certified proxy frees aggregate body budget after rejecting overflow across loopbacks", async (context) => {
  if (!(await hasIpv6Loopback())) return context.skip("IPv6 loopback is unavailable on this host");
  let upstreamRequests = 0;
  let announceSecond: (() => void) | undefined;
  let announceThird: (() => void) | undefined;
  const secondForwarded = new Promise<void>((resolve) => {
    announceSecond = resolve;
  });
  const thirdForwarded = new Promise<void>((resolve) => {
    announceThird = resolve;
  });
  const upstream = createServer((request) => {
    request.resume();
    upstreamRequests += 1;
    if (upstreamRequests === 2) announceSecond?.();
    if (upstreamRequests === 3) announceThird?.();
  });
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  const largeBody = completionBody(11 * 1024 * 1024);
  const smallBody = JSON.stringify({ model, messages: [] });
  let held: Promise<Response | undefined>[] = [];
  try {
    proxy.beginCell("aggregate-body-limit");
    held = [proxy.baseUrl, proxy.baseUrl.replace(/localhost|127\.0\.0\.1/u, "[::1]")].map((url) =>
      fetch(`${url}/chat/completions`, { method: "POST", body: largeBody }).catch(() => undefined),
    );
    await within(secondForwarded, "Proxy did not admit the aggregate body budget", 5_000);
    const rejected = await within(
      fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST", body: largeBody }),
      "Proxy did not reject aggregate body overflow",
      5_000,
    );
    assert.equal(rejected.status, 403);
    await rejected.text();
    assert.equal(upstreamRequests, 2);
    held.push(fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST", body: smallBody }).catch(() => undefined));
    await within(thirdForwarded, "Proxy did not release body budget after rejection");
    assert.equal(upstreamRequests, 3);
    assert.throws(() => proxy.endCell("aggregate-body-limit"), /pending|rejected/u);
  } finally {
    await proxy.close();
    await Promise.all(held);
    await close(upstream);
  }
});

test("request deadline closes a pending inbound body and leaves the proxy closeable", async (context) => {
  const upstream = createServer((_request, reply) => reply.end("unexpected"));
  const port = await listen(upstream);
  const proxy = await startCertifiedEgressProxy({
    upstreamBaseUrl: `http://127.0.0.1:${port}/v1`,
    expectedModel: model,
  });
  let announceHandled: (() => void) | undefined;
  const handled = new Promise<void>((resolve) => {
    announceHandled = resolve;
  });
  const originalHandle = proxy.handle.bind(proxy);
  proxy.handle = (request, reply) => {
    originalHandle(request, reply);
    announceHandled?.();
  };
  let socket: Socket | undefined;
  try {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    proxy.beginCell("pending-inbound-deadline");
    socket = await openPartialRequest(`${proxy.baseUrl}/chat/completions`, JSON.stringify({ model, messages: [] }));
    socket.on("error", () => undefined);
    const closed = once(socket, "close");
    await handled;
    context.mock.timers.tick(30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await closed;
    await proxy.close();
    assert.throws(() => proxy.endCell("pending-inbound-deadline"), /rejected|missing/u);
  } finally {
    socket?.destroy();
    await proxy.close();
    await close(upstream);
  }
});
