# 2026-09-01 — Stale indexing artifacts can block Core AI reinstall

- **Status:** Partial
- **Task/context:** Recover the mandatory P reinstall and indexing smoke before binding benchmark candidate rc.59.
- **Unexpected observation or failure:** Core AI candidate compilation repeatedly failed to allocate file-backed storage while the APFS Data volume had less than 2 GiB available.
- **Evidence:** The Data volume reported 100% capacity. Two non-current Core AI generations occupied about 1.18 GiB each, and an unused ONNX fallback cache occupied about 4.8 GiB. `current.json`, process arguments, and open-file checks proved none of those paths was active before removal.
- **Approaches tried:**
  - **Attempt:** Retry with the indexing daemon quiesced.
    - **Outcome:** Did not work
    - **Why:** launchd `KeepAlive` restarted Qdrant, and disk pressure remained.
  - **Attempt:** Remove only validated stale, regenerable accelerator artifacts and boot out the service before probing.
    - **Outcome:** Partial
    - **Why:** It restored several GiB and removed Qdrant contention, but a separate host-level Core AI load failure remained and required a supported backend fallback.
- **Root cause:** Regenerable accelerator generations and caches accumulated without a pre-install space check or garbage-collection policy; launchd restart ordering also allowed the old backend to compete during resource-heavy validation.
- **Resolution:** Removed only explicitly validated non-current Core AI generations and the unused ONNX fallback cache. Preserved the current Core AI artifact, Qdrant data, and benchmark evidence.
- **Verification:** Removed paths were absent, `current.json` still named the canonical artifact, no process had the deleted paths open, and available space increased before retrying installation.
- **Prevention/follow-up:** Add bounded stale accelerator-cache garbage collection, a disk-space preflight, and service bootout before resource-heavy backend validation. These code changes remain open.
- **Reusable learning:** Validate current ownership and open-file state before deleting accelerator caches, and reserve build headroom before compiling Core AI artifacts.
- **References:** `scripts/install-apple-coreai.js`, `scripts/install-indexing-service.js`, `reinstall.sh`
