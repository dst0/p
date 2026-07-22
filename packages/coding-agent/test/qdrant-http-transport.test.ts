import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("Qdrant HTTP transport", () => {
	it("runs semantic_search after P installs its undici fetch globals", async () => {
		const fixture = path.join(testDirectory, "fixtures", "qdrant-http-transport.ts");
		const { stdout } = await execFileAsync(process.execPath, [fixture], {
			timeout: 15_000,
			env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
		});
		expect(stdout.trim()).toBe("semantic_search transport ok");
	});
});
