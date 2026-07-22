import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";

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
		const executable = join(directory, "fake-qdrant.mjs");
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

		const manager = new QdrantServerManager(await availablePort(), {
			qdrantBinary: executable,
			dataDirectory: join(directory, "data"),
			startupTimeoutMs: 5_000,
		});
		try {
			expect(await manager.ensureStarted()).toBe(true);
			manager.kill();
			expect(await manager.ensureStarted()).toBe(true);
		} finally {
			await manager.stop();
		}
	}, 10_000);
});
