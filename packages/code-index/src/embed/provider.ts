/**
 * Pluggable embedding provider interface.
 *
 * Returns Float32Array for dense vectors to minimize GC pressure.
 */
export interface EmbeddingProvider {
	/** Dense vector dimension. */
	dim: number;

	/** Encode a batch of texts into dense vectors. */
	encode(texts: string[]): Promise<Float32Array[]>;

	/** Encode a single query text. */
	encodeQuery(text: string): Promise<Float32Array>;
}
