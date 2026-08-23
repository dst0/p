# 2026-08-24 — Benchmark evidence must mirror runtime markers and prompt projection authority

- **Status:** Partial
- **Task/context:** Certifying the installed compiled-instruction runtime before assigning the first immutable `5.0.1-rc.N` paired-benchmark candidate.
- **Unexpected observation or failure:** The installed compiled startup probe reported that no compiled marker was present even though the cache held a successful compact artifact. The benchmark also assumed one manifest source, treated only the canonical artifact prompt as valid, and retained untrusted child evidence objects after checking their required fields.
- **Evidence:** The live v14 artifact contained four source records, a 344-byte always-on body, a 1,198-byte canonical prompt, and a 1,964-byte worst-case injected result. Its marker included `agents_sha256`, `input_sha256`, and `mode`, but the old adjacency-sensitive expression expected `mode` immediately after the agents hash. Production had also correctly removed exact reader/fallback guidance for the available tool set, so the injected prompt hash differed from the canonical manifest hash.
- **Approaches tried:**
  - **Attempt:** Relax only the failed marker expression and accept the manifest prompt hash directly.
    - **Outcome:** Did not work
    - **Why:** It would preserve duplicate grammar, miss marker/source identity, and authorize a canonical prompt that production never injects.
  - **Attempt:** Use one strict shared marker parser, identify exactly one canonical workspace source within a multi-source manifest, enumerate production-exact tool-conditioned prompt projections before task work, bind that set into the immutable seed receipt, and project every child/public evidence object into an exact schema.
    - **Outcome:** Worked
    - **Why:** Runtime and benchmark now share one marker contract, child evidence cannot authorize its own prompt mutation, and unknown or malformed nested data either disappears or fails the correctness gate.
- **Root cause:** The benchmark independently approximated evolving runtime syntax and trusted validation as if it also sanitized and authorized child-owned data.
- **Resolution:** Centralize strict marker parsing; bind agents hash, input hash, artifact mode, exact workspace source path/hash, cache closure, and all authorized prompt projections; require exact equality with the trusted pre-task receipt; fail closed on malformed high-risk arrays; and exact-pick public compiler usage, seed certificates, instruction evidence, metrics, quality checks, and sample fields.
- **Verification:** The script suite passes 243/243, the complete project-instruction suite passes 277/277 across 62 files, and an independent adversarial review passes 53/53 with no P0-P2 finding. A rebuilt same-provider installed compiled/legacy smoke is still required before this learning is fully resolved.
- **Prevention/follow-up:** Regenerate the installed compiled proof after reinstall, never reuse the stale pre-parser proof, and keep exact-set parity tests wherever the immutable JavaScript benchmark snapshot must duplicate a production constant.
- **Reusable learning:** Benchmark evidence is a security boundary: mirror the runtime grammar exactly, derive authority before untrusted work begins, and construct retained public schemas instead of returning validated child objects.
- **References:** `scripts/benchmark-project-instruction-marker.js`, `scripts/benchmark-project-instruction-prompt-projection.js`, `scripts/benchmark-project-instruction-seed-record.js`, `scripts/benchmark-project-instruction-evidence-projection.js`, `scripts/benchmark-project-instructions-sample-projection.js`, `packages/coding-agent/docs/benchmarking.md`.
