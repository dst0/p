import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingServerManager } from "../src/embed/server.ts";

const servers: Server[] = [];
type HealthResponse = number | "reject" | "timeout";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startHealthServer(responses: HealthResponse[]): Promise<number> {
  let requestIndex = 0;
  const server = createServer((_request, response) => {
    const healthResponse = responses[Math.min(requestIndex, responses.length - 1)];
    requestIndex += 1;
    if (healthResponse === "reject") {
      response.destroy();
      return;
    }
    if (healthResponse === "timeout") return;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ready", embeddingRequests: { active: healthResponse } }));
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

    await expect(manager.waitUntilIdle(10_000)).resolves.toBe(true);
  });

  it("retries a rejected health request while the total deadline remains", async () => {
    const manager = new EmbeddingServerManager(await startHealthServer(["reject", 0]));

    await expect(manager.waitUntilIdle(10_000)).resolves.toBe(true);
  });

  it("retries after one health-attempt timeout while the total deadline remains", async () => {
    const manager = new EmbeddingServerManager(await startHealthServer(["timeout", 0]));

    await expect(manager.waitUntilIdle(10_000)).resolves.toBe(true);
  });

  it("cancels a non-ok response body before retrying the health probe", async () => {
    let bodyCanceled = false;
    const unavailableBody = new ReadableStream({
      cancel: () => {
        bodyCanceled = true;
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(unavailableBody, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ embeddingRequests: { active: 0 } }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    const manager = new EmbeddingServerManager(1);

    await expect(manager.waitUntilIdle(10_000)).resolves.toBe(true);
    expect(bodyCanceled).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not accept an idle body parsed after the total deadline", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValue(1_011)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embeddingRequests: { active: 0 } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const manager = new EmbeddingServerManager(1);

    await expect(manager.waitUntilIdle(10)).resolves.toBe(false);
  });

  it("fails closed when the server cannot be reached", async () => {
    const manager = new EmbeddingServerManager(1);

    await expect(manager.waitUntilIdle(100)).resolves.toBe(false);
  });

  it("times out when the server remains busy", async () => {
    const manager = new EmbeddingServerManager(await startHealthServer([1]));

    await expect(manager.waitUntilIdle(75)).resolves.toBe(false);
  });

  it("aborts the in-flight response at the total deadline without scheduling another probe", async () => {
    let abortedRequests = 0;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Expected a health-probe abort signal");
          signal.addEventListener(
            "abort",
            () => {
              abortedRequests += 1;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const manager = new EmbeddingServerManager(1);

    await expect(manager.waitUntilIdle(75)).resolves.toBe(false);
    expect(abortedRequests).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const attemptTimeoutMs = timeoutSpy.mock.calls[0]?.[0];
    expect(attemptTimeoutMs).toBeGreaterThan(0);
    expect(attemptTimeoutMs).toBeLessThanOrEqual(75);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
