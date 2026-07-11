import type { EmbeddingProvider } from "./provider.ts";
import { EmbeddingServerManager } from "./server.ts";

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
	private started = false;

	constructor(baseUrl: string, dim: number, autoStart: boolean = true, model: string = "Qwen/Qwen3-Embedding-0.6B") {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.dim = dim;
		const port = parseInt(baseUrl.match(/:(\d+)/)?.[1] ?? "8081", 10);
		this.serverManager = autoStart ? new EmbeddingServerManager(port, model) : null;
	}

	/**
	 * Ensure the embedding server is running. Called lazily before encoding.
	 */
	async ensureReady(): Promise<void> {
		if (this.started) return;
		if (this.serverManager) {
			await this.serverManager.ensureStarted();
		}
		this.started = true;
	}

	async encode(texts: string[]): Promise<Float32Array[]> {
		await this.ensureReady();
		const batchSize = 32;
		const allVectors: Float32Array[] = [];

		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const vectors = await this.request(batch);
			allVectors.push(...vectors);
		}

		return allVectors;
	}

	async encodeQuery(text: string): Promise<Float32Array> {
		await this.ensureReady();
		const vectors = await this.encode([text]);
		return vectors[0];
	}

	/**
	 * Stop the managed server process.
	 */
	stop(): void {
		this.serverManager?.kill();
		this.started = false;
	}

	private async request(input: string[]): Promise<Float32Array[]> {
		const response = await fetch(`${this.baseUrl}/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input, normalize: true }),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Embedding server error ${response.status}: ${body}`);
		}

		const raw = (await response.json()) as Record<string, unknown>;
		const embeddings = raw.embeddings as unknown[][];
		return embeddings.map((row) => new Float32Array(row as number[]));
	}
}

/**
 * Create the default HTTP embedding provider (auto-starts server).
 */
export function createDefaultProvider(url: string, dim: number): EmbeddingProvider {
	return new EmbeddingProviderHttp(url, dim, true);
}
