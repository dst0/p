import { EmbeddingError } from "./errors.ts";
import type { EmbeddingProvider } from "./provider.ts";
import { EmbeddingServerManager, type EmbeddingServerManagerOptions } from "./server.ts";

export interface EmbeddingProviderHttpOptions extends EmbeddingServerManagerOptions {
	requestTimeoutMs: number;
	maxRetries: number;
}

const DEFAULT_HTTP_OPTIONS: EmbeddingProviderHttpOptions = {
	requestTimeoutMs: 30_000,
	maxRetries: 2,
	startupTimeoutMs: 120_000,
	pythonExecutable: "python3",
};

/**
 * HTTP embedding provider — calls a local embedding server over HTTP.
 *
 * Returns Float32Array[] for dense vectors to minimize GC pressure.
 *
 * When `autoStart` is true (default), the provider automatically starts
 * the Python embedding server subprocess on first encode call.
 */
export class EmbeddingProviderHttp implements EmbeddingProvider {
	private baseUrl: string;
	public dim: number;
	private serverManager: EmbeddingServerManager | null;
	private options: EmbeddingProviderHttpOptions;

	constructor(
		baseUrl: string,
		dim: number,
		autoStart: boolean = true,
		model: string = "Qwen/Qwen3-Embedding-0.6B",
		options: Partial<EmbeddingProviderHttpOptions> = {},
	) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.dim = dim;
		this.options = { ...DEFAULT_HTTP_OPTIONS, ...options };
		const port = parseInt(baseUrl.match(/:(\d+)/)?.[1] ?? "18742", 10);
		const isLocal =
			baseUrl.includes("localhost") ||
			baseUrl.includes("127.0.0.1") ||
			baseUrl.includes("0.0.0.0") ||
			baseUrl.includes("::1");
		this.serverManager = autoStart && isLocal ? new EmbeddingServerManager(port, model, this.options) : null;
	}

	/**
	 * Ensure the embedding server is running. Called lazily before encoding.
	 * Always checks health and restarts if the server is down.
	 * Does not pass the caller's signal to startup — startup has its own timeout.
	 */
	async ensureReady(_signal?: AbortSignal): Promise<void> {
		if (this.serverManager) {
			await this.serverManager.ensureStarted();
		}
	}

	async encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		if (signal?.aborted) throw signal.reason ?? new Error("Embedding request cancelled");
		const batchSize = 32;
		const allVectors: Float32Array[] = [];

		for (let i = 0; i < texts.length; i += batchSize) {
			if (signal?.aborted) throw signal.reason ?? new Error("Embedding request cancelled");
			const batch = texts.slice(i, i + batchSize);
			const vectors = await this.request(batch, signal);
			allVectors.push(...vectors);
		}

		return allVectors;
	}

	async encodeQuery(text: string, signal?: AbortSignal): Promise<Float32Array> {
		if (signal?.aborted) throw signal.reason ?? new Error("Embedding request cancelled");
		const vectors = await this.encode([text], signal);
		if (!vectors[0]) throw new Error("Embedding server returned no query vector");
		return vectors[0];
	}

	/**
	 * Stop the managed server process.
	 */
	stop(): void {
		this.serverManager?.kill();
	}

	async dispose(): Promise<void> {
		await this.serverManager?.stop();
	}

	private async request(input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		await this.ensureReady(signal);
		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
			try {
				const requestSignal = AbortSignal.any([
					AbortSignal.timeout(this.options.requestTimeoutMs),
					...(signal ? [signal] : []),
				]);
				const response = await fetch(`${this.baseUrl}/embed`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ input, normalize: true }),
					signal: requestSignal,
				});
				if (!response.ok) {
					const body = (await response.text()).slice(0, 500);
					const error = new EmbeddingError("server_error", `Embedding server error ${response.status}: ${body}`);
					if (response.status < 500 || attempt === this.options.maxRetries) throw error;
					lastError = error;
				} else {
					return this.parseResponse(await response.json(), input.length);
				}
			} catch (error) {
				if (signal?.aborted) throw signal.reason ?? new Error("Embedding request cancelled");
				if (error instanceof EmbeddingError && error.type === "server_error") {
					if (attempt === this.options.maxRetries) throw error;
					lastError = error;
				} else if (error instanceof Error && error.name === "TimeoutError") {
					if (attempt === this.options.maxRetries) {
						throw new EmbeddingError("server_down", "Embedding server request timed out");
					}
					lastError = error;
				} else if (error instanceof EmbeddingError) {
					throw error;
				} else {
					// Network-level failure (ECONNREFUSED, ENETUNREACH, fetch failed)
					if (attempt === this.options.maxRetries) {
						const cause =
							error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 500) : String(error);
						throw new EmbeddingError("server_down", `Embedding server unreachable: ${cause}`);
					}
					lastError = error instanceof Error ? error : new Error(String(error));
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt + Math.floor(Math.random() * 50)));
		}
		throw lastError ?? new EmbeddingError("server_down", "Embedding request failed");
	}

	private parseResponse(value: unknown, expectedRows: number): Float32Array[] {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("Embedding server returned an invalid response");
		}
		const embeddings = (value as Record<string, unknown>).embeddings;
		if (!Array.isArray(embeddings) || embeddings.length !== expectedRows) {
			throw new Error(
				`Embedding server returned ${Array.isArray(embeddings) ? embeddings.length : 0} vectors; expected ${expectedRows}`,
			);
		}
		return embeddings.map((row) => {
			if (
				!Array.isArray(row) ||
				row.length !== this.dim ||
				row.some((item) => typeof item !== "number" || !Number.isFinite(item))
			) {
				throw new Error(`Embedding vector dimensions do not match configured dimension ${this.dim}`);
			}
			return new Float32Array(row);
		});
	}
}

/**
 * Create the default HTTP embedding provider (auto-starts server).
 */
export function createDefaultProvider(url: string, dim: number): EmbeddingProvider {
	return new EmbeddingProviderHttp(url, dim, true);
}
