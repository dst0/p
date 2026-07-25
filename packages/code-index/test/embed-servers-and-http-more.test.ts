import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingError } from "../src/embed/errors.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate a test port");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function createExitingScript(directory: string, name: string): string {
  const scriptPath = join(directory, name);
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env node",
      "console.log('test stdout output');",
      "console.error('test stderr output');",
      "setTimeout(() => process.exit(1), 50);",
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

function createHangingScript(directory: string, name: string): string {
  const scriptPath = join(directory, name);
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env node",
      "console.log('hanging process started');",
      "setInterval(() => {}, 1000);",
      "process.on('SIGTERM', () => process.exit(0));",
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

describe("EmbeddingServerManager edge cases", () => {
  it("handles aborted signal on ensureStarted before start", async () => {
    const manager = new EmbeddingServerManager(await availablePort());
    const controller = new AbortController();
    controller.abort(new Error("Startup aborted by test"));

    await expect(manager.ensureStarted(controller.signal)).rejects.toThrow("Startup aborted by test");
  });

  it("handles aborted signal on ensureStarted during startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-embed-abort-"));
    temporaryDirectories.push(dir);
    const script = createHangingScript(dir, "hanging-python.js");

    const port = await availablePort();
    const manager = new EmbeddingServerManager(port, "Qwen/Qwen3-Embedding-0.6B", {
      pythonExecutable: script,
      startupTimeoutMs: 5000,
    });

    const controller = new AbortController();
    const promise = manager.ensureStarted(controller.signal);

    // abort after a small delay so it happens during startup
    setTimeout(() => {
      controller.abort(new Error("Startup aborted during wait"));
    }, 100);

    await expect(promise).rejects.toThrow("Startup aborted during wait");
  });

  it("handles process early exit and logs stdout/stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-embed-exit-"));
    temporaryDirectories.push(dir);
    const script = createExitingScript(dir, "exiting-python.js");

    const logs: Array<{ level: string; message: string }> = [];
    const port = await availablePort();
    const manager = new EmbeddingServerManager(port, "Qwen/Qwen3-Embedding-0.6B", {
      pythonExecutable: script,
      startupTimeoutMs: 5000,
      onLog: (level, message) => logs.push({ level, message }),
    });

    await expect(manager.ensureStarted()).rejects.toThrow("Embedding server exited before readiness");
    expect(logs.some((l) => l.message.includes("test stdout output"))).toBe(true);
    expect(logs.some((l) => l.message.includes("test stderr output"))).toBe(true);
  });

  it("handles startup timeout when server remains unready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-embed-timeout-"));
    temporaryDirectories.push(dir);
    const script = createHangingScript(dir, "hanging-python.js");

    const port = await availablePort();
    const manager = new EmbeddingServerManager(port, "Qwen/Qwen3-Embedding-0.6B", {
      pythonExecutable: script,
      startupTimeoutMs: 1500,
    });

    try {
      await expect(manager.ensureStarted()).rejects.toThrow("Embedding server failed to start within timeout");
    } finally {
      await manager.stop();
    }
  }, 10_000);

  it("invokes kill method directly", () => {
    const manager = new EmbeddingServerManager(18742);
    const stopSpy = vi.spyOn(manager, "stop").mockResolvedValue(undefined);
    manager.kill();
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe("QdrantServerManager edge cases", () => {
  it("handles aborted signal on ensureStarted before start", async () => {
    const manager = new QdrantServerManager(await availablePort());
    const controller = new AbortController();
    controller.abort(new Error("Qdrant startup cancelled"));

    await expect(manager.ensureStarted(controller.signal)).rejects.toThrow("Qdrant startup cancelled");
  });

  it("handles aborted signal on ensureStarted during startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-qdrant-abort-"));
    temporaryDirectories.push(dir);
    const script = createHangingScript(dir, "hanging-qdrant.js");

    const port = await availablePort();
    const manager = new QdrantServerManager(port, {
      qdrantBinary: script,
      dataDirectory: join(dir, "data"),
      startupTimeoutMs: 5000,
    });

    const controller = new AbortController();
    const promise = manager.ensureStarted(controller.signal);

    // abort after a small delay so it happens during startup
    setTimeout(() => {
      controller.abort(new Error("Qdrant startup aborted during wait"));
    }, 100);

    await expect(promise).rejects.toThrow("Qdrant startup aborted during wait");
  });

  it("handles process early exit and logs stdout/stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-qdrant-exit-"));
    temporaryDirectories.push(dir);
    const script = createExitingScript(dir, "exiting-qdrant.js");

    const logs: Array<{ level: string; message: string }> = [];
    const port = await availablePort();
    const manager = new QdrantServerManager(port, {
      qdrantBinary: script,
      dataDirectory: join(dir, "data"),
      startupTimeoutMs: 5000,
      onLog: (level, message) => logs.push({ level, message }),
    });

    await expect(manager.ensureStarted()).rejects.toThrow("Qdrant exited with code 1");
    expect(logs.some((l) => l.message.includes("test stdout output"))).toBe(true);
    expect(logs.some((l) => l.message.includes("test stderr output"))).toBe(true);
  });

  it("handles startup timeout for Qdrant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p-qdrant-timeout-"));
    temporaryDirectories.push(dir);
    const script = createHangingScript(dir, "hanging-qdrant.js");

    const port = await availablePort();
    const manager = new QdrantServerManager(port, {
      qdrantBinary: script,
      dataDirectory: join(dir, "data"),
      startupTimeoutMs: 1000,
    });

    try {
      await expect(manager.ensureStarted()).rejects.toThrow("Qdrant failed to start within the configured timeout");
    } finally {
      await manager.stop();
    }
  }, 10_000);

  it("invokes kill method directly", () => {
    const manager = new QdrantServerManager(6333);
    const stopSpy = vi.spyOn(manager, "stop").mockResolvedValue(undefined);
    manager.kill();
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe("EmbeddingProviderHttp edge cases", () => {
  it("handles autoStart=false or remote URL (no serverManager)", async () => {
    const provider = new EmbeddingProviderHttp("http://remote-server.com:18742", 1024, false);
    await expect(provider.ensureReady()).resolves.toBeUndefined();
  });

  it("handles aborted signal in encode and encodeQuery", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false);
    const controller = new AbortController();
    controller.abort();

    await expect(provider.encode(["text"], controller.signal)).rejects.toThrow();
    await expect(provider.encodeQuery("text", controller.signal)).rejects.toThrow();
  });

  it("throws error when encode returns empty vector list for encodeQuery", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false);
    vi.spyOn(provider, "encode").mockResolvedValue([]);

    await expect(provider.encodeQuery("query")).rejects.toThrow("Embedding server returned no query vector");
  });

  it("handles retries on HTTP 500 error and eventual failure", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 1,
      requestTimeoutMs: 1000,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Error", { status: 500, statusText: "Internal Error" }),
    );

    await expect(provider.encode(["text"])).rejects.toThrow(EmbeddingError);
  });

  it("handles retries on TimeoutError", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
      requestTimeoutMs: 1000,
    });

    const timeoutError = new Error("Request timeout");
    timeoutError.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeoutError);

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server request timed out");
  });

  it("handles non-Error objects thrown during request", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 0,
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValue("string_error_reason");

    await expect(provider.encode(["text"])).rejects.toThrow("Embedding server unreachable: string_error_reason");
  });

  it("handles retrying when fetch rejects with a server_error EmbeddingError", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 1,
    });

    const error = new EmbeddingError("server_error", "Mock server error");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(error).mockRejectedValueOnce(error);

    await expect(provider.encode(["text"])).rejects.toThrow("Mock server error");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws immediately without retrying when fetch rejects with a non-server_error EmbeddingError", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, false, "Qwen/Qwen3-Embedding-0.6B", {
      maxRetries: 1,
    });

    const error = new EmbeddingError("network", "Mock invalid request");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(error);

    await expect(provider.encode(["text"])).rejects.toThrow("Mock invalid request");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("calls dispose to stop serverManager", async () => {
    const provider = new EmbeddingProviderHttp("http://localhost:28742", 1024, true);
    const stopSpy = vi.spyOn((provider as any).serverManager, "stop").mockResolvedValue(undefined);

    await provider.dispose();
    expect(stopSpy).toHaveBeenCalled();
  });
});
