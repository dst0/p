import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EmbeddingServerManager } from "../src/embed/server.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startHealthServer(activeRequests: number[]): Promise<number> {
  let requestIndex = 0;
  const server = createServer((_request, response) => {
    const active = activeRequests[Math.min(requestIndex, activeRequests.length - 1)];
    requestIndex += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ready", embeddingRequests: { active } }));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

describe("EmbeddingServerManager.waitUntilIdle", () => {
  it("waits until the server reports that no embedding request is active", async () => {
    const manager = new EmbeddingServerManager(await startHealthServer([1, 0]));

    await expect(manager.waitUntilIdle(2_000)).resolves.toBe(true);
  });

  it("fails closed when the server cannot be reached", async () => {
    const manager = new EmbeddingServerManager(1);

    await expect(manager.waitUntilIdle(100)).resolves.toBe(false);
  });

  it("times out when the server remains busy", async () => {
    const manager = new EmbeddingServerManager(await startHealthServer([1]));

    await expect(manager.waitUntilIdle(75)).resolves.toBe(false);
  });
});
