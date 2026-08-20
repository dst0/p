# Project instructions

p discovers `AGENTS.md` or `CLAUDE.md` from the global agent directory, ancestor directories, and the current working directory. The source files remain authoritative. At session startup, p compiles their prompt-facing representation and stores a derived cache under the repository workspace root:

```text
.pdev/instructions/
├── current.json
├── compilations/<agents-hash>-<compiler-hash>.json
├── compilations/<agents-hash>-<compiler-hash>-<model-hash>.failure.json
├── inputs/<input-hash>/fallback.md
└── versions/<input-hash>-<result-hash>/
    ├── manifest.json
    ├── prompt.md
    ├── rules/
    │   ├── catalog.md
    │   ├── catalog-pages/*.md
    │   └── <module>.md
    └── skills/
        ├── catalog.md
        └── catalog-pages/*.md
```

`.pdev` is ignored by Git. Deleting `.pdev/instructions` while p is stopped is safe; p regenerates it from the authoritative source files on the next session start.

## Hash and compilation lifecycle

The manifest records a SHA-256 hash for the complete ordered context-file chain and a separate input hash covering that chain, visible canonical skill roots, and the compiler schema version.

- p first measures the exact representation. If the complete block fits, p injects it unchanged and does not call a model.
- If exact text does not fit, p reuses a successful compiler result keyed only by the AGENTS/CLAUDE chain hash and compiler version. On a miss, a dedicated request sends the complete instruction sources to the selected model so it can infer activity-specific retrieval conditions.
- Visible skill changes produce a new input hash and deterministic catalog, but do not resend an unchanged AGENTS/CLAUDE chain to the model.
- A failed, malformed, unavailable, or context-window-incompatible compilation produces a deterministic fallback. It is not accepted as a successful compiler cache. p applies a five-minute backoff only to the same failing model identity; a changed or newly available model retries immediately, and the same model retries after the backoff.
- `/reload` refreshes source and skill hashes, the cache, and the current system prompt.
- Concurrent writers use unique temporary paths and atomic installation. Each live session remains pinned to its immutable version even if another input updates `current.json`.

Large sources are split only at UTF-8-safe boundaries. Concatenating their stored modules reproduces the complete source text exactly. The model supplies only the bounded routing body and triggers; exact modules remain authoritative. Large catalogs are paginated so every advertised catalog link remains readable within the tool limit.

The complete injected block—including the body, retrieval instructions, and catalog links—is strictly less than 5,000 characters. The internal block budget is 4,996 characters because system-prompt assembly adds three separator characters around it.

## `read_rules` and `read_skills`

Extracted AGENTS/CLAUDE sections are instruction modules, not ordinary user skills. Their separate readers keep those semantics explicit:

- `read_rules({ links: [...] })` reads `rules/catalog.md`, its explicitly manifest-bound catalog pages, or exact module links advertised by the catalog.
- `read_skills({ links: [...] })` reads `skills/catalog.md`, its manifest-bound pages, a listed virtual `skills/<id>/SKILL.md` link, or a relative resource confined beneath that skill's canonical directory.

Both tools accept only catalog-relative links. Rule modules, catalog pages, and skill roots must be cataloged; skill-relative resources are root-scoped rather than individually enumerated. The readers reject absolute paths, traversal, stale sources, oversized responses, cache tampering, and symlink escapes. File size is checked before response allocation, and one call is capped at 512,000 bytes.

Explicit `--tools` allowlists and `--exclude-tools` still control whether these built-ins are available. Every injected block contains an absolute ordinary-read fallback path under `inputs/<input-hash>/fallback.md`. That guide lists the authoritative source files, skill roots, and physical immutable catalog paths, so retrieval remains actionable with only the normal `read` tool.

The skill catalog maps virtual links to the discovered source skill directories instead of copying arbitrary skill trees into `.pdev`. A skill-root hash protects catalog freshness, while canonical path containment protects relative resource reads.

SDK callers can pass `projectInstructionCompiler` to `createAgentSession()` to replace the default selected-model compiler. The override receives the full source chain and deterministic module IDs and must return a compact body plus triggers keyed by those IDs.

## Storage and privacy

Cache directories use mode `0700` and cache files use mode `0600` on supported platforms. p confines the cache to the workspace, refuses symlinked cache components, and validates every manifest against freshly discovered sources, module identities, and canonical skill roots before trusting cached paths.

The cache uses small Markdown and JSON files instead of Brotli. These artifacts need direct per-module and random-access reads, individual integrity checks, and atomic replacement; stream compression would make that access pattern less reliable without meaningful storage savings. The cache never contains provider credentials, but it does contain local copies of discovered instruction text. The selected model receives the complete sources only when a large chain has no reusable successful compilation; small exact chains and skill-only changes do not cause that disclosure.
