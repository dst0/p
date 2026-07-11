/**
 * Embedding module — re-exports the pluggable provider interface, HTTP provider, and server manager.
 */

export type { createDefaultProvider, EmbeddingProviderHttp } from "./embed/http.ts";
export type { EmbeddingProvider } from "./embed/provider.ts";
export type { EmbeddingServerManager } from "./embed/server.ts";
