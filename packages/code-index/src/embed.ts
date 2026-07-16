/**
 * Embedding module — re-exports the pluggable provider interface, HTTP provider, and server manager.
 */

export type { EmbeddingProviderHttpOptions } from "./embed/http.ts";
export { createDefaultProvider, EmbeddingProviderHttp } from "./embed/http.ts";
export type { EmbeddingProvider } from "./embed/provider.ts";
export type { EmbeddingServerManagerOptions } from "./embed/server.ts";
export { EmbeddingServerManager } from "./embed/server.ts";
