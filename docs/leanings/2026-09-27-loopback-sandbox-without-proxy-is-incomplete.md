# 2026-09-27 — Loopback sandbox rules need an end-to-end proxy contract

- **Status:** Open
- **Task/context:** Testing a proposed replacement for certified benchmark wildcard-port egress in draft PR #138.
- **Unexpected observation or failure:** A macOS sandbox profile that allowed only `localhost:<port>` denied external destinations in focused tests, but the benchmark still validated external host declarations and launched agents with their original direct model endpoints. No benchmark-owned proxy was started or injected.
- **Evidence:** Five focused profile/socket tests passed. Independent review found that runtime validation accepted an external hostname that the first sandboxed command would later reject. A separate listener on IPv6 loopback `::1` at the same port was reachable under the `localhost` SBPL rule, so an IPv4-only proxy listener was not an exact endpoint boundary.
- **Approaches tried:**
  - **Attempt:** Replace wildcard `*:<port>` with a validated `localhost:<port>` sandbox rule alone.
    - **Outcome:** Partial
    - **Why:** Direct external egress was denied, but real certified model traffic had no configured route through an owned proxy, and dual-stack loopback semantics remained.
  - **Attempt:** Keep the hardened profile as a standalone change.
    - **Outcome:** Did not work
    - **Why:** It would break existing certified runs without proving the intended end-to-end containment or request parity.
- **Root cause:** Network policy, CLI endpoint validation, agent configuration, and proxy lifecycle were changed independently rather than as one runtime contract.
- **Resolution:** The incomplete profile patch was not shipped. The existing documented port-only limitation remains explicit until a complete design is implemented and verified.
- **Verification:** The rejected patch's five focused tests passed, but independent runtime-path review exposed the missing proxy and validation mismatch. No real provider or benchmark run was claimed.
- **Prevention/follow-up:** Build a parent-owned proxy with explicit upstream/model/API allowlisting, zero candidate secrets, captured sanitized wire receipts, and dual-stack loopback tests. Update validation, CLI help, agent configs, and sandbox policy together; prove a real P/Pi/Kilo preflight through that path before certification.
- **Reusable learning:** A passing sandbox profile test is not a working or secure agent network path; test the full route and every address family before claiming endpoint isolation.
- **References:** `benchmarks/src/harness/benchmark-isolation.ts`, `benchmarks/src/workloads/benchmark-runtime-validation.ts`, `benchmarks/src/workloads/agent-command.ts`, `benchmarks/README.md`.
