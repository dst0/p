# @dst0/p-code-index

Local hybrid codebase indexing using dense embeddings, frozen-generation BM25 sparse vectors, Qdrant retrieval, and Node-side reciprocal-rank fusion.

The package provides repository discovery, security exclusions, semantic chunking, embedding providers, Qdrant integration, versioned manifests, incremental refresh, and a typed `CodeRagService` used by p's `semantic_search` tool.

For source checkouts, `./reinstall.sh` installs a singleton per-user macOS or Linux background service and verifies it with a real temporary-repository semantic-search call. The service starts Qdrant and the embedding backend lazily, indexes only repositories explicitly enabled in interactive p, watches enabled repositories for changes, and periodically reconciles missed events. Searches reload atomically persisted manifests, while missing backend collections force a new isolated generation.

User-facing installation, opt-in, commands, configuration, privacy, data paths, and troubleshooting are documented in [Code indexing](../coding-agent/docs/code-indexing.md). The process and retrieval boundaries are detailed in [Code indexing architecture](../coding-agent/docs/architecture.md).
