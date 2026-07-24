import { describe, expect, it, vi } from "vitest";
import type { ExecutionEnv, Result } from "../../src/harness/types.ts";
import { executeShellWithCapture, sanitizeBinaryOutput } from "../../src/harness/utils/shell-output.ts";
import { DEFAULT_MAX_BYTES } from "../../src/harness/utils/truncate.ts";

type MockEnvOptions = {
	execResult?: Result<{ exitCode: number }, unknown>;
	execThrows?: boolean;
};

function createMockEnv(options: Partial<MockEnvOptions> = {}): ExecutionEnv {
	return {
		cwd: "/tmp",
		absolutePath: vi.fn().mockResolvedValue({ ok: true, value: "/tmp" }),
		joinPath: vi.fn().mockResolvedValue({ ok: true, value: "/tmp" }),
		readTextFile: vi.fn().mockResolvedValue({ ok: true, value: "" }),
		readTextLines: vi.fn().mockResolvedValue({ ok: true, value: [] }),
		readBinaryFile: vi.fn().mockResolvedValue({ ok: true, value: new Uint8Array() }),
		writeFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		appendFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		fileInfo: vi
			.fn()
			.mockResolvedValue({ ok: true, value: { name: "f", path: "/f", kind: "file", size: 0, mtimeMs: 0 } }),
		listDir: vi.fn().mockResolvedValue({ ok: true, value: [] }),
		canonicalPath: vi.fn().mockResolvedValue({ ok: true, value: "/tmp" }),
		exists: vi.fn().mockResolvedValue({ ok: true, value: true }),
		createDir: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		remove: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		createTempDir: vi.fn().mockResolvedValue({ ok: true, value: "/tmp/dir" }),
		createTempFile: vi.fn().mockResolvedValue({ ok: true, value: "/tmp/file.log" }),
		cleanup: vi.fn().mockResolvedValue(undefined),
		exec: vi.fn().mockImplementation(async (_cmd, _opts) => {
			if (options.execThrows) throw new Error("spawn failed");
			return options.execResult ?? { ok: true, value: { exitCode: 0 } };
		}),
	};
}

describe("sanitizeBinaryOutput", () => {
	it("keeps printable ASCII characters", () => {
		expect(sanitizeBinaryOutput("hello world")).toBe("hello world");
	});

	it("keeps tab, newline, and carriage return", () => {
		expect(sanitizeBinaryOutput("\t\n\r")).toBe("\t\n\r");
	});

	it("removes control characters", () => {
		expect(sanitizeBinaryOutput("a\x00b\x01c\x1fd")).toBe("abcd");
	});

	it("removes non-character private use areas", () => {
		expect(sanitizeBinaryOutput("a\ufff9b\ufffb")).toBe("ab");
	});

	it("keeps emoji and other valid characters", () => {
		expect(sanitizeBinaryOutput("hello \ud83c\udf0d")).toBe("hello \ud83c\udf0d");
	});
});

describe("executeShellWithCapture", () => {
	it("should return successful output", async () => {
		const env = createMockEnv({ execResult: { ok: true, value: { exitCode: 0 } } });
		const result = await executeShellWithCapture(env, "echo hello");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.cancelled).toBe(false);
			expect(result.value.exitCode).toBe(0);
		}
	});

	it("should propagate exec errors", async () => {
		const env = createMockEnv({
			execResult: { ok: false, error: { code: "spawn_error", message: "no such command" } },
		});
		const result = await executeShellWithCapture(env, "nonexistent");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("spawn_error");
		}
	});

	it("should handle aborted execution with cancelled result", async () => {
		const env = createMockEnv({
			execResult: { ok: false, error: { code: "aborted", message: "aborted" } },
		});
		const result = await executeShellWithCapture(env, "echo hello");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.cancelled).toBe(true);
			expect(result.value.exitCode).toBe(undefined);
		}
	});

	it("should handle abort signal aborted flag even without abort error code", async () => {
		const env = createMockEnv({
			execResult: { ok: false, error: { code: "unknown", message: "failed" } },
		});
		const controller = new AbortController();
		controller.abort();
		const result = await executeShellWithCapture(env, "echo hello", { abortSignal: controller.signal });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.cancelled).toBe(true);
		}
	});

	it("should handle uncaught errors from exec", async () => {
		const env = createMockEnv({ execThrows: true });
		const result = await executeShellWithCapture(env, "echo hello");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("unknown");
		}
	});

	it("should call onChunk callback with sanitized output", async () => {
		const chunks: string[] = [];
		const env = createMockEnv({ execResult: { ok: true, value: { exitCode: 0 } } });
		env.exec = vi.fn().mockImplementation(async (_cmd, opts) => {
			opts?.onStdout?.("hello");
			opts?.onStderr?.("world");
			return { ok: true, value: { exitCode: 0 } };
		});
		const result = await executeShellWithCapture(env, "echo hello", {
			onChunk: (chunk: string) => chunks.push(chunk),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.output).toBe("helloworld");
		}
		expect(chunks).toContain("hello");
	});

	it("should create temp file when output exceeds DEFAULT_MAX_BYTES", async () => {
		const env = createMockEnv({ execResult: { ok: true, value: { exitCode: 0 } } });
		env.exec = vi.fn().mockImplementation(async (_cmd, opts) => {
			const largeChunk = "x".repeat(DEFAULT_MAX_BYTES + 1000);
			opts?.onStdout?.(largeChunk);
			return { ok: true, value: { exitCode: 0 } };
		});
		const result = await executeShellWithCapture(env, "echo big");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.truncated).toBe(true);
			expect(result.value.fullOutputPath).toBeDefined();
		}
	});

	it("should strip carriage returns from output", async () => {
		const env = createMockEnv({ execResult: { ok: true, value: { exitCode: 0 } } });
		env.exec = vi.fn().mockImplementation(async (_cmd, opts) => {
			opts?.onStdout?.("line1\r\nline2\r\n");
			return { ok: true, value: { exitCode: 0 } };
		});
		const result = await executeShellWithCapture(env, "echo crlf");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.output).toBe("line1\nline2\n");
		}
	});

	it("should trim old chunks when output exceeds max buffer", async () => {
		const env = createMockEnv({ execResult: { ok: true, value: { exitCode: 0 } } });
		env.exec = vi.fn().mockImplementation(async (_cmd, options) => {
			// Produce > maxOutputBytes (DEFAULT_MAX_BYTES * 2 = 100KB) of multi-line output
			for (let i = 0; i < 20; i++) {
				options?.onStdout?.(`line${i}${"\n".repeat(6000)}`);
			}
			return { ok: true, value: { exitCode: 0 } };
		});
		const result = await executeShellWithCapture(env, "echo lots");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.truncated).toBe(true);
			expect(result.value.fullOutputPath).toBeDefined();
			// truncateTail keeps the tail, so the last lines should be present
			expect(result.value.output).toContain("line19");
		}
	});

	it("should pass through cwd and env options", async () => {
		const env = createMockEnv({ execResult: { ok: true, value: { exitCode: 0 } } });
		await executeShellWithCapture(env, "echo hello", { cwd: "/app", env: { PATH: "/usr/bin" } });
		expect(env.exec).toHaveBeenCalledWith(
			"echo hello",
			expect.objectContaining({
				cwd: "/app",
				env: { PATH: "/usr/bin" },
			}),
		);
	});
});
