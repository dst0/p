import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Manages the lifecycle of the Python embedding server subprocess.
 * Starts the server on demand, polls /health until ready, and cleans up on exit.
 */
export class EmbeddingServerManager {
	private child: ReturnType<typeof spawn> | null = null;
	private scriptPath: string;
	private port: number;
	private model: string;
	private started = false;

	constructor(port: number = 8081, model: string = "Qwen/Qwen3-Embedding-0.6B") {
		this.port = port;
		this.model = model;
		// Resolve the Python script relative to this package
		this.scriptPath = path.join(__dirname, "..", "..", "embedding_server.py");
	}

	/**
	 * Start the embedding server if not already running.
	 * Returns true if this instance started the server, false if already running.
	 */
	async ensureStarted(): Promise<boolean> {
		if (this.started) {
			return false;
		}

		// Check if something is already listening on the port
		const alreadyRunning = await this.checkHealth();
		if (alreadyRunning) {
			this.started = true;
			console.log(`  ⚡ Embedding server already running on port ${this.port}`);
			return false;
		}

		console.log(`  🚀 Starting embedding server (port ${this.port}, model ${this.model})...`);

		return new Promise((resolve, reject) => {
			this.child = spawn("python3", [this.scriptPath, "--port", String(this.port), "--model", this.model], {
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
			});

			this.child.stdout?.on("data", (data) => {
				const text = data.toString().trim();
				if (text) console.log(`  [embed-server] ${text}`);
			});

			this.child.stderr?.on("data", (data) => {
				const text = data.toString().trim();
				if (text) console.error(`  [embed-server] ${text}`);
			});

			this.child.on("error", (err) => {
				this.child = null;
				reject(new Error(`Failed to start embedding server: ${err.message}`));
			});

			this.child.on("exit", (code, signal) => {
				if (this.child) {
					console.error(`  [embed-server] Exited with code ${code}, signal ${signal}`);
					this.child = null;
					this.started = false;
				}
			});

			// Poll /health until the server reports ready or timeout
			const timeout = 120_000; // 2 min
			const interval = 1000;
			const deadline = Date.now() + timeout;

			const poll = async () => {
				try {
					const ok = await this.checkHealth();
					if (ok) {
						this.started = true;
						console.log(`  ✅ Embedding server ready`);
						resolve(true);
						return;
					}
				} catch {
					// ignore during startup
				}

				if (Date.now() >= deadline) {
					this.kill();
					reject(new Error("Embedding server failed to start within timeout"));
					return;
				}

				setTimeout(poll, interval);
			};

			setTimeout(poll, 2000); // initial delay for model loading
		});
	}

	/**
	 * Kill the managed server process.
	 */
	kill(): void {
		if (this.child) {
			this.child.kill("SIGTERM");
			this.child = null;
			this.started = false;
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
