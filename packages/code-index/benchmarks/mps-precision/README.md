# MPS precision indexing benchmark

This benchmark generates a deterministic temporary Git repository and performs two complete, isolated Code RAG rebuilds with Qwen3 Embedding on MPS. FP32 and BF16 use the same files, 512-token fixed input shape, batch size 1, Qdrant configuration, and semantic-search validation.

Run it from `packages/code-index` after building the workspace:

```bash
npm run benchmark:mps-precision
```

The benchmark requires exclusive MPS access and refuses to run while the installed indexing daemon is active. On macOS, stop and restore the service around the run:

```bash
launchctl bootout "gui/$(id -u)/com.dst.p.code-index"
npm run benchmark:mps-precision
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.dst.p.code-index.plist"
```

Options:

```text
--files N                 Generated source-file count (default: 16)
--functions-per-file N    Functions per generated file (default: 12)
--keep                    Retain the generated repository and Qdrant data
```

The JSON report includes model startup time, full rebuild time, embedding-phase chunks per second, peak Python RSS, model bytes, execution device, fallback/OOM state, and the measured BF16 speedup. Set `P_INDEX_BENCHMARK_PYTHON` or `P_INDEX_BENCHMARK_QDRANT` to override managed executable paths.

## Observed result

One complete run on 2026-08-10 used an Apple M4 MacBook Air (10 cores, 24 GB unified memory), macOS 27.0, PyTorch 2.12.1, 16 generated files, 12 functions per file, and 400 indexed chunks:

| Precision | Indexing | Full rebuild | Model bytes | Peak Python RSS |
| --- | ---: | ---: | ---: | ---: |
| FP32 | 2.10 chunks/s | 192.07 s | 2,383,106,048 | 3,762.81 MiB |
| BF16 | 2.01 chunks/s | 199.82 s | 1,191,553,024 | 682.83 MiB |

Both runs executed on `mps:0`, returned five semantic-search results, and reported no fallback or OOM backoff. BF16 provided `0.96x` FP32 throughput in this run (about 4% slower), while reducing planned model memory by 50% and observed peak Python RSS by about 82%. This is a single-run result rather than a statistical performance claim; it is sufficient to reject an expected near-`2x` BF16 speedup on this stack.
