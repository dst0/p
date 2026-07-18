# @dst0/p-code-index

Hybrid codebase indexing for Qdrant using dense embeddings and BM25 sparse vectors.

The package exposes repository discovery, semantic chunking, embedding providers, Qdrant integration, and the `code-index` CLI.

`p` installs a per-user background service on macOS and Linux that starts the local Qdrant and embedding backends on demand, indexes opted-in repositories, and refreshes them when files change.
