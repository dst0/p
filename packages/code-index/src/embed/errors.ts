/** Errors thrown by the embedding subsystem so callers can distinguish root cause. */
export class EmbeddingError extends Error {
	readonly type: "server_down" | "server_error" | "network";

	constructor(type: "server_down" | "server_error" | "network", message: string) {
		super(message);
		this.name = "EmbeddingError";
		this.type = type;
	}
}

/** Errors thrown by the Qdrant vector store so callers can distinguish root cause. */
export class VectorStoreError extends Error {
	readonly type: "qdrant_down" | "qdrant_error" | "network";

	constructor(type: "qdrant_down" | "qdrant_error" | "network", message: string) {
		super(message);
		this.name = "VectorStoreError";
		this.type = type;
	}
}
