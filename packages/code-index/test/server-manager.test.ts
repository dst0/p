import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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

describe("QdrantServerManager", () => {
  it("waits for an in-flight stop before restarting on the same port", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p-qdrant-manager-"));
    temporaryDirectories.push(directory);
    const executable = join(directory, "fake-qdrant.js");
    writeFileSync(
      executable,
      [
        "#!/usr/bin/env node",
        'import fs from "node:fs";',
        'import http from "node:http";',
        "const args = process.argv.slice(2);",
        'const configIndex = args.indexOf("--config-path");',
        'const config = fs.readFileSync(args[configIndex + 1], "utf8");',
        "const port = Number(config.match(/http_port:\\s*(\\d+)/)?.[1]);",
        "const server = http.createServer((_request, response) => {",
        '  response.setHeader("content-type", "application/json");',
        '  response.end(JSON.stringify({ status: "ok" }));',
        "});",
        'server.listen(port, "127.0.0.1");',
        'process.on("SIGTERM", () => {',
        "  setTimeout(() => server.close(() => process.exit(0)), 1_000);",
        "});",
      ].join("\n"),
    );
    chmodSync(executable, 0o700);

    const logs: Array<{ level: string; msg: string }> = [];
    const manager = new QdrantServerManager(await availablePort(), {
      qdrantBinary: executable,
      dataDirectory: join(directory, "data"),
      startupTimeoutMs: 5_000,
      onLog: (level, msg) => logs.push({ level, msg }),
    });
    try {
      expect(await manager.ensureStarted()).toBe(true);
      manager.kill();
      expect(await manager.ensureStarted()).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      await manager.stop();
    }
  }, 10_000);

  it("handles aborted signal on ensureStarted", async () => {
    const manager = new QdrantServerManager(9999, {
      qdrantBinary: "non-existent-binary-12345",
      startupTimeoutMs: 1_000,
    });

    const controller = new AbortController();
    controller.abort(new Error("Startup cancelled"));

    await expect(manager.ensureStarted(controller.signal)).rejects.toThrow("Startup cancelled");
  });

  it("rejects when qdrant binary fails to spawn or exits early", async () => {
    const manager = new QdrantServerManager(await availablePort(), {
      qdrantBinary: "non-existent-binary-12345",
      startupTimeoutMs: 1_000,
    });

    await expect(manager.ensureStarted()).rejects.toThrow("Failed to start Qdrant");
  });

  it("reuses existing identical config file in writeConfig", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p-qdrant-cfg-"));
    temporaryDirectories.push(directory);
    const executable = join(directory, "fake-qdrant.js");
    writeFileSync(
      executable,
      [
        "#!/usr/bin/env node",
        'import fs from "node:fs";',
        'import http from "node:http";',
        "const args = process.argv.slice(2);",
        'const configIndex = args.indexOf("--config-path");',
        'const config = fs.readFileSync(args[configIndex + 1], "utf8");',
        "const port = Number(config.match(/http_port:\\s*(\\d+)/)?.[1]);",
        "const server = http.createServer((_request, response) => {",
        '  response.setHeader("content-type", "application/json");',
        '  response.end(JSON.stringify({ status: "ok" }));',
        "});",
        'server.listen(port, "127.0.0.1");',
        'process.on("SIGTERM", () => process.exit(0));',
      ].join("\n"),
    );
    chmodSync(executable, 0o700);

    const port = await availablePort();
    const manager = new QdrantServerManager(port, {
      qdrantBinary: executable,
      dataDirectory: join(directory, "data"),
      startupTimeoutMs: 5_000,
    });

    try {
      await manager.ensureStarted();
      await manager.stop();
      // Second ensureStarted reuses existing config file
      await manager.ensureStarted();
    } finally {
      await manager.stop();
    }
  });
});

describe("EmbeddingServerManager", () => {
  it("starts and manages a fake python embedding server subprocess", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p-embed-manager-"));
    temporaryDirectories.push(directory);
    const fakePython = join(directory, "fake-python.js");
    writeFileSync(
      fakePython,
      [
        "#!/usr/bin/env node",
        'import http from "node:http";',
        "const args = process.argv.slice(2);",
        'const portIndex = args.indexOf("--port");',
        "const port = Number(args[portIndex + 1]);",
        "console.log('Server starting stdout');",
        "console.error('Server starting stderr');",
        "const server = http.createServer((request, response) => {",
        '  if (request.url === "/health") {',
        '    response.setHeader("content-type", "application/json");',
        '    response.end(JSON.stringify({ status: "ready" }));',
        "  } else {",
        "    response.statusCode = 404;",
        "    response.end();",
        "  }",
        "});",
        'server.listen(port, "127.0.0.1");',
        'process.on("SIGTERM", () => {',
        "  server.close(() => process.exit(0));",
        "});",
      ].join("\n"),
    );
    chmodSync(fakePython, 0o700);

    const logs: Array<{ level: string; message: string }> = [];
    const port = await availablePort();
    const manager = new EmbeddingServerManager(port, "Qwen/Qwen3-Embedding-0.6B", {
      pythonExecutable: fakePython,
      startupTimeoutMs: 5_000,
      onLog: (level, message) => logs.push({ level, message }),
    });

    try {
      const started = await manager.ensureStarted();
      expect(started).toBe(true);

      // Second ensureStarted when server is healthy returns false
      const startedAgain = await manager.ensureStarted();
      expect(startedAgain).toBe(false);

      expect(logs.some((l) => l.message.includes("Server starting stdout"))).toBe(true);
      expect(logs.some((l) => l.message.includes("Server starting stderr"))).toBe(true);
    } finally {
      await manager.stop();
    }
  }, 10_000);

  it("handles aborted signal during start", async () => {
    const port = await availablePort();
    const manager = new EmbeddingServerManager(port, "model", {
      pythonExecutable: "non-existent-python-12345",
      startupTimeoutMs: 1_000,
    });
    const controller = new AbortController();
    controller.abort(new Error("Startup cancelled"));

    await expect(manager.ensureStarted(controller.signal)).rejects.toThrow("Startup cancelled");
  });

  it("rejects when python binary fails to spawn", async () => {
    const port = await availablePort();
    const manager = new EmbeddingServerManager(port, "model", {
      pythonExecutable: "non-existent-python-12345",
      startupTimeoutMs: 1_000,
    });

    await expect(manager.ensureStarted()).rejects.toThrow("Failed to start embedding server");
  });
});
