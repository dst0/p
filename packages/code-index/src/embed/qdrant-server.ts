import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface QdrantServerManagerOptions {
	qdrantBinary: string;
	dataDirectory: string;
	startupTimeoutMs: number;
	onLog?: (level: "debug" | "error", message: string) => void;
}

const DEFAULT_QDRANT_OPTIONS: QdrantServerManagerOptions = {
	qdrantBinary: "qdrant",
	dataDirectory: path.join(os.homedir(), ".p", "agent", "code-rag", "qdrant"),
	startupTimeoutMs: 30_000,
};

/** Starts and monitors one local Qdrant process. */
export class QdrantServerManager {
	private child: ReturnType<typeof spawn> | null = null;
	private readonly port: number;
	private readonly options: QdrantServerManagerOptions;
	private startPromise: Promise<boolean> | undefined;

	constructor(port: number = 6333, options: Partial<QdrantServerManagerOptions> = {}) {
		this.port = port;
		this.options = { ...DEFAULT_QDRANT_OPTIONS, ...options };
	}

	async ensureStarted(signal?: AbortSignal): Promise<boolean> {
		if (await this.checkHealth()) return false;
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.start(signal).finally(() => {
			this.startPromise = undefined;
		});
		return this.startPromise;
	}

	kill(): void {
		const child = this.child;
		this.child = null;
		child?.kill("SIGTERM");
	}

	private async start(signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) throw signal.reason ?? new Error("Qdrant startup cancelled");
		if (await this.checkHealth()) return false;

		const configPath = this.writeConfig();
		this.options.onLog?.("debug", `Starting Qdrant on port ${this.port}`);

		return new Promise((resolve, reject) => {
			let settled = false;
			let pollTimer: ReturnType<typeof setTimeout> | undefined;
			const child = spawn(this.options.qdrantBinary, ["--config-path", configPath, "--disable-telemetry"], {
				cwd: this.options.dataDirectory,
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
			});
			this.child = child;

			const settle = (callback: () => void) => {
				if (settled) return;
				settled = true;
				if (pollTimer) clearTimeout(pollTimer);
				signal?.removeEventListener("abort", onAbort);
				callback();
			};
			const onAbort = () => {
				if (this.child === child) this.kill();
				settle(() => reject(signal?.reason ?? new Error("Qdrant startup cancelled")));
			};
			signal?.addEventListener("abort", onAbort, { once: true });

			child.stdout?.on("data", (data) => {
				const message = String(data).trim();
				if (message) this.options.onLog?.("debug", message);
			});
			child.stderr?.on("data", (data) => {
				const message = String(data).trim();
				if (message) this.options.onLog?.("error", message);
			});
			child.on("error", (error) => {
				if (this.child === child) this.child = null;
				settle(() => reject(new Error(`Failed to start Qdrant: ${error.message}`)));
			});
			child.on("exit", (code, exitSignal) => {
				if (this.child !== child) return;
				this.child = null;
				const message = `Qdrant exited with code ${code}, signal ${exitSignal}`;
				this.options.onLog?.("error", message);
				settle(() => reject(new Error(`${message} before readiness`)));
			});

			const deadline = Date.now() + this.options.startupTimeoutMs;
			const poll = async () => {
				if (await this.checkHealth()) {
					this.options.onLog?.("debug", "Qdrant is ready");
					settle(() => resolve(true));
					return;
				}
				if (Date.now() >= deadline) {
					if (this.child === child) this.kill();
					settle(() => reject(new Error("Qdrant failed to start within the configured timeout")));
					return;
				}
				pollTimer = setTimeout(() => void poll(), 500);
			};
			pollTimer = setTimeout(() => void poll(), 500);
		});
	}

	private writeConfig(): string {
		fs.mkdirSync(this.options.dataDirectory, { recursive: true, mode: 0o700 });
		const storagePath = path.join(this.options.dataDirectory, "storage");
		fs.mkdirSync(storagePath, { recursive: true, mode: 0o700 });
		const configPath = path.join(this.options.dataDirectory, "config.yaml");
		const content = [
			"log_level: INFO",
			"storage:",
			`  storage_path: ${JSON.stringify(storagePath)}`,
			"service:",
			"  host: 127.0.0.1",
			`  http_port: ${this.port}`,
			`  grpc_port: ${this.port + 1}`,
			"telemetry_disabled: true",
			"",
		].join("\n");
		if (!fs.existsSync(configPath) || fs.readFileSync(configPath, "utf-8") !== content) {
			fs.writeFileSync(configPath, content, { mode: 0o600 });
		}
		return configPath;
	}

	private async checkHealth(): Promise<boolean> {
		try {
			const response = await fetch(`http://127.0.0.1:${this.port}/collections`, {
				signal: AbortSignal.timeout(2_000),
			});
			if (!response.ok) return false;
			const body = (await response.json()) as Record<string, unknown>;
			return body.status === "ok";
		} catch {
			return false;
		}
	}
}
