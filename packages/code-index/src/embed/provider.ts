export interface EmbeddingProvider {
	/** Dense vector dimension. */
	dim: number;

	/** Encode a batch of texts into dense vectors. */
	encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;

	/** Encode a single query text. */
	encodeQuery(text: string, signal?: AbortSignal): Promise<Float32Array>;

	/** Ensure the provider is ready (e.g. start embedding server). Called before encoding. */
	ensureReady?(signal?: AbortSignal): Promise<void>;

	/** Release provider-owned resources. */
	dispose?(): Promise<void> | void;
}
