import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface EmbeddingServerManagerOptions {
	pythonExecutable: string;
	startupTimeoutMs: number;
	onLog?: (level: "debug" | "error", message: string) => void;
}

const DEFAULT_SERVER_OPTIONS: EmbeddingServerManagerOptions = {
	pythonExecutable: "python3",
	startupTimeoutMs: 120_000,
};

/**
 * Manages the lifecycle of the Python embedding server subprocess.
 * Starts the server on demand, polls /health until ready, and cleans up on exit.
 */
export class EmbeddingServerManager {
	private child: ReturnType<typeof spawn> | null = null;
	private scriptPath: string;
	private port: number;
	private model: string;
	private startPromise: Promise<boolean> | undefined;
	private options: EmbeddingServerManagerOptions;

	constructor(
		port: number = 8081,
		model: string = "Qwen/Qwen3-Embedding-0.6B",
		options: Partial<EmbeddingServerManagerOptions> = {},
	) {
		this.port = port;
		this.model = model;
		this.options = { ...DEFAULT_SERVER_OPTIONS, ...options };
		// Resolve the Python script relative to this package
		this.scriptPath = path.join(__dirname, "..", "..", "embedding_server.py");
	}

	/**
	 * Start the embedding server if not already running.
	 * Always checks health first to detect externally-killed servers.
	 * Returns true if this instance started the server, false if already running.
	 */
	async ensureStarted(signal?: AbortSignal): Promise<boolean> {
		// Always check health — server could have died externally
		const alive = await this.checkHealth();
		if (alive) {
			return false;
		}

		// Server is down — restart
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.start(signal).finally(() => {
			this.startPromise = undefined;
		});
		return this.startPromise;
	}

	private async start(signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) throw signal.reason ?? new Error("Embedding server startup cancelled");

		// Check if something is already listening on the port
		const alreadyRunning = await this.checkHealth();
		if (alreadyRunning) {
			this.options.onLog?.("debug", `Embedding server already running on port ${this.port}`);
			return false;
		}

		this.options.onLog?.("debug", `Starting embedding server on port ${this.port}`);

		return new Promise((resolve, reject) => {
			let settled = false;
			let pollTimer: ReturnType<typeof setTimeout> | undefined;
			const settle = (callback: () => void) => {
				if (settled) return;
				settled = true;
				if (pollTimer) clearTimeout(pollTimer);
				signal?.removeEventListener("abort", onAbort);
				callback();
			};
			const onAbort = () => {
				this.kill();
				settle(() => reject(signal?.reason ?? new Error("Embedding server startup cancelled")));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			const child = spawn(
				this.options.pythonExecutable,
				[this.scriptPath, "--port", String(this.port), "--model", this.model],
				{
					stdio: ["ignore", "pipe", "pipe"],
					detached: false,
				},
			);
			this.child = child;

			child.stdout?.on("data", (data) => {
				const text = data.toString().trim();
				if (text) this.options.onLog?.("debug", text);
			});

			child.stderr?.on("data", (data) => {
				const text = data.toString().trim();
				if (text) this.options.onLog?.("error", text);
			});

			child.on("error", (err) => {
				if (this.child === child) this.child = null;
				settle(() => reject(new Error(`Failed to start embedding server: ${err.message}`)));
			});

			child.on("exit", (code, signal) => {
				if (this.child === child) {
					this.options.onLog?.("error", `Embedding server exited with code ${code}, signal ${signal}`);
					this.child = null;
					settle(() =>
						reject(new Error(`Embedding server exited before readiness (code ${code}, signal ${signal})`)),
					);
				}
			});

			// Poll /health until the server reports ready or timeout
			const interval = 1000;
			const deadline = Date.now() + this.options.startupTimeoutMs;

			const poll = async () => {
				try {
					const ok = await this.checkHealth();
					if (ok) {
						this.options.onLog?.("debug", "Embedding server ready");
						settle(() => resolve(true));
						return;
					}
				} catch {
					// ignore during startup
				}

				if (Date.now() >= deadline) {
					this.kill();
					settle(() => reject(new Error("Embedding server failed to start within timeout")));
					return;
				}

				pollTimer = setTimeout(() => void poll(), interval);
			};

			pollTimer = setTimeout(() => void poll(), 2000); // initial delay for model loading
		});
	}

	/**
	 * Kill the managed server process.
	 */
	kill(): void {
		if (this.child) {
			this.child.kill("SIGTERM");
			this.child = null;
		}
	}

	/**
	 * Check if the server is healthy and ready.
	 */
	private async checkHealth(): Promise<boolean> {
		try {
			const resp = await fetch(`http://127.0.0.1:${this.port}/health`, {
				signal: AbortSignal.timeout(2000),
			});
			if (!resp.ok) return false;
			const body = (await resp.json()) as Record<string, string>;
			return body.status === "ready";
		} catch {
			return false;
		}
	}
}
