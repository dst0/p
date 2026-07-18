# Code Indexing

p can maintain a local semantic index for repositories that you explicitly enable. The `semantic_search` tool uses the index to find code by concept when an exact symbol, literal, or path is not known.

Code indexing is local by default. Repository text is sent to the local embedding server and stored in a local Qdrant database. It is not sent to a remote embedding provider unless you explicitly configure remote backends.

## Install the background service

For a source checkout, run:

```bash
./reinstall.sh
```

On supported macOS and Linux systems, this builds and relinks p, then installs the per-user `com.dst.p.code-index` service. The installer supports arm64 and x64, downloads a checksummed Qdrant binary, and creates a Python virtual environment with pinned embedding dependencies.

The service starts at login and restarts after failures. Qdrant and the embedding server start lazily after at least one repository is enabled. The first index may download the configured embedding model and can take several minutes for a large repository.

The service installer currently supports:

- macOS arm64 and x64 through launchd;
- Linux arm64 and x64 through a systemd user service;
- Python 3.10 or newer, except Intel macOS, which requires Python 3.10–3.12.

Normal npm installation does not run this source-checkout service installer.

## Enable a repository

When interactive p first opens a repository with no saved indexing decision, it asks whether to index it:

- **Yes** enables the repository and starts background indexing.
- **No** records the decision and does not ask again for that repository.
- Dismissing the selector leaves the decision unknown, so p may ask again the next time it opens the repository.

p uses the nearest parent containing `.git` as the repository root. A directory outside a Git repository is treated as its own indexing root.

Indexing decisions are independent of project trust. Enabling indexing authorizes the local service to read indexable repository files and store their derived chunks and vectors locally.

## Commands

| Command | Behavior |
|---|---|
| `/index` | Show the repository decision, background-service state, index state, file/chunk counts, and last error |
| `/index enable` | Enable indexing for the active repository |
| `/index disable` | Stop watching and refreshing the active repository |

Disabling a repository preserves its existing index data. It can be enabled again without discarding the last compatible generation.

## Background behavior

For every enabled repository, the service:

1. initializes the local Qdrant and embedding backends on demand;
2. builds or incrementally refreshes the repository index;
3. watches the repository recursively for file changes;
4. debounces bursts of writes before refreshing;
5. retries transient failures;
6. periodically reconciles the repository to recover from missed filesystem events.

Refreshes compare current file hashes with the stored manifest. Added and changed files are embedded, deleted files are removed, and unchanged files are not re-embedded. Repository locks prevent concurrent refreshes from corrupting an index, and a live lock is never stolen solely because it is old.

Common generated and dependency directories such as `.git`, `node_modules`, `dist`, `build`, `coverage`, `target`, and `storage` are ignored by the watcher. Repository discovery also applies `.gitignore`, secret-file exclusions, binary and file-size limits, and out-of-root symlink protection.

The `semantic_search` tool checks the repository opt-in registry before accessing the index. When indexing is disabled or has not been approved, it returns `RAG_DISABLED` and directs the agent to exact search and file reads.

## Local files and processes

With the default agent directory, indexing state is stored under `~/.p/agent`:

| Path | Purpose |
|---|---|
| `indexed-repos.json` | Saved enabled/disabled decision for each repository |
| `indexing-service-status.json` | Daemon PID, state, repository status, counts, and errors |
| `code-rag.json` | User-level code-index configuration |
| `code-rag/<repo-id>/` | Repository manifests and sparse-vocabulary data |
| `code-rag/qdrant/` | Managed Qdrant configuration and database |
| `indexing-service/bin/qdrant` | Managed Qdrant binary |
| `indexing-service/venv/` | Managed Python environment |
| `indexing-service/logs/` | Service stdout and stderr logs |

Set `P_CODING_AGENT_DIR` to move the entire agent directory. The service installer records the selected absolute paths when it is installed, so rerun `./reinstall.sh` after changing that location or the checkout path.

## Configuration

Code-index settings are loaded in this order, with later sources overriding earlier ones:

1. built-in defaults;
2. `~/.p/agent/code-rag.json`;
3. `<repository>/.p/code-rag.json`;
4. supported environment variables;
5. explicit SDK options.

Important fields include:

```json
{
  "enabled": true,
  "autoRefresh": true,
  "allowStaleSearch": true,
  "qdrantUrl": "http://127.0.0.1:6333",
  "embeddingServerUrl": "http://127.0.0.1:8081",
  "embeddingModel": "Qwen/Qwen3-Embedding-0.6B",
  "embeddingDimensions": 1024,
  "defaultLimit": 8,
  "maxLimit": 20,
  "maxFileBytes": 1048576
}
```

Supported environment overrides include `P_CODE_RAG_ENABLED`, `P_CODE_RAG_AUTO_REFRESH`, `P_CODE_RAG_QDRANT_URL`, `P_CODE_RAG_QDRANT_BINARY`, `P_CODE_RAG_QDRANT_DATA_DIR`, `P_CODE_RAG_EMBEDDING_URL`, `P_CODE_RAG_EMBEDDING_MODEL`, and `P_CODE_RAG_PYTHON`.

Remote Qdrant or embedding URLs are rejected unless `remoteBackendsAllowed` is explicitly enabled. The managed local Qdrant auto-start applies only to loopback endpoints.

## Troubleshooting

Start with `/index`. If the background service is not running or reports an error:

1. rerun `./reinstall.sh` from the current checkout;
2. inspect `~/.p/agent/indexing-service/logs/service-error.log`;
3. confirm the configured Python version is supported;
4. check available disk space for the model cache and Qdrant database;
5. use exact search and file reads while the index is initializing or unavailable.

Reinstalling is idempotent and migrates the former `com.dst.p.code-index-embedding` service to the current combined indexing service.

The current UI exposes status, enable, and disable controls. Dedicated manual refresh/rebuild and index-data deletion commands are not yet exposed; the watcher and periodic reconciliation perform normal refreshes automatically.
