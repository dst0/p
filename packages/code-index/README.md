# @dst0/p-code-index

Local hybrid codebase indexing for Qdrant using dense embeddings and frozen-generation BM25 sparse vectors.

The package provides repository discovery, security exclusions, semantic chunking, embedding providers, Qdrant integration, versioned manifests, incremental refresh, and a typed `CodeRagService` used by p's `semantic_search` tool.

For source checkouts, `./reinstall.sh` installs a per-user macOS or Linux background service. The service starts Qdrant and the embedding backend lazily, indexes only repositories explicitly enabled in interactive p, watches enabled repositories for changes, and periodically reconciles missed events.

User-facing installation, opt-in, commands, configuration, privacy, data paths, and troubleshooting are documented in [Code indexing](../coding-agent/docs/code-indexing.md).
