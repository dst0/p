# 2026-09-03 — MPS unified memory must not double-count VRAM

- **Status:** Resolved
- **Task/context:** Running the mandatory real semantic-search smoke after reinstall on a 24 GiB Apple Silicon host.
- **Unexpected observation or failure:** The embedding server refused to load its 0.6B BF16 model with about 4.08 GiB available even though the same source, venv, model, and configuration were otherwise healthy.
- **Evidence:** A direct embedding-server reproduction reported `insufficient accelerator and system memory`. The planner charged MPS both the system reserve and a separate 10% of total memory as if it were dedicated VRAM. Adding a regression at 4 GiB available reproduced the false refusal; the live model loaded on MPS after the correction with a 512 MiB accelerator reserve and retained safety headroom.
- **Approaches tried:**
  - **Attempt:** Recreate the managed venv under supported Python 3.12.
    - **Outcome:** Partial
    - **Why:** Dependency installation succeeded but did not change the independent resource-plan refusal.
  - **Attempt:** Treat MPS as the unified-memory accelerator it is while retaining the existing system reserve, minimum accelerator reserve, staging check, workspace check, and fail-closed OOM behavior.
    - **Outcome:** Worked
    - **Why:** It removed only the fictitious dedicated-VRAM reserve without relaxing the real unified-memory budget.
- **Root cause:** `SHARED_MEMORY_ACCELERATORS` covered NPU/APU backends but omitted MPS, so one physical memory pool was reserved twice.
- **Resolution:** Classify MPS as shared memory and reject an unusable refreshed runtime plan before encoding rather than continuing with a stale active plan.
- **Verification:** Focused resource and MPS policy tests pass; a real Python 3.12 embedding server loaded `Qwen/Qwen3-Embedding-0.6B` on MPS with BF16, batch size 8, and the preserved reserve values.
- **Prevention/follow-up:** Keep cold-start and post-load pressure regressions together; new unified-memory backends must never inherit dedicated-VRAM accounting by default.
- **Reusable learning:** Resource planners must model physical memory topology, not API labels; unified accelerators share the system budget and need one coordinated reserve.
- **References:** `packages/code-index/resource_manager.py`, `packages/code-index/embedding_server.py`, `packages/code-index/test/test_resource_manager.py`, `packages/code-index/test/test_mps_memory_policy.py`
