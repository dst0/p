import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import {
  closeCertifiedProxyServer,
  listenCertifiedProxyServer,
  openCertifiedProxyLoopbacks,
} from "../../src/harness/certified-proxy-listeners.ts";

test("IPv4-only hosts retain a usable listener and close without an unstarted IPv6 server", async () => {
  const { port, servers } = await openCertifiedProxyLoopbacks(
    (_request, reply) => reply.end("ok"),
    30_000,
    8,
    (server, host, requestedPort) => {
      if (host === "::1")
        return Promise.reject(Object.assign(new Error("IPv6 unavailable"), { code: "EADDRNOTAVAIL" }));
      return listenCertifiedProxyServer(server, host, requestedPort);
    },
  );
  try {
    assert.equal(servers.length, 1);
    const body = await new Promise<string>((resolve, reject) => {
      const client = request(`http://127.0.0.1:${port}`, (reply) => {
        let text = "";
        reply.setEncoding("utf8").on("data", (chunk: string) => {
          text += chunk;
        });
        reply.once("end", () => resolve(text));
      });
      client.once("error", reject);
      client.end();
    });
    assert.equal(body, "ok");
  } finally {
    await Promise.all(servers.map(closeCertifiedProxyServer));
  }
});

test("unexpected IPv6 listener failures close the IPv4 listener and fail startup", async () => {
  let ipv4Server: Parameters<typeof listenCertifiedProxyServer>[0] | undefined;
  await assert.rejects(
    openCertifiedProxyLoopbacks(
      (_request, reply) => reply.end(),
      30_000,
      8,
      (server, host, requestedPort) => {
        if (host === "::1") return Promise.reject(Object.assign(new Error("unexpected"), { code: "EACCES" }));
        ipv4Server = server;
        return listenCertifiedProxyServer(server, host, requestedPort);
      },
    ),
    /unexpected/u,
  );
  assert.equal(ipv4Server?.listening, false);
});
