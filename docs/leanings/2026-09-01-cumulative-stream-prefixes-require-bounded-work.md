# 2026-09-01 — Cumulative stream prefixes require bounded work

- **Status:** Resolved
- **Task/context:** Diagnosing slow OpenAI-compatible tool-call streaming and oversized coding-agent JSON event output during many small deltas.
- **Unexpected observation or failure:** Each tool-argument delta reparsed the complete cumulative JSON prefix, while JSON print mode serialized cumulative assistant snapshots with every delta. Both paths amplified linear streams toward quadratic CPU or output volume.
- **Evidence:** A 13,406-character tool payload split into one-character deltas caused 13,407 parses and 89,880,527 parsed characters. Adaptive checkpoints reduced this to 7 parses and 29,534 parsed characters while preserving exact final nested arguments. A 400-delta JSON regression reconstructs text and tool arguments losslessly from bounded events without `partial`, duplicate `message`, or provider scratch fields.
- **Approaches tried:**
  - **Attempt:** Parse or serialize the growing prefix after every delta, or only reduce the frequency by a fixed interval.
    - **Outcome:** Did not work
    - **Why:** Per-delta work is quadratic, and a fixed interval only reduces its constant while retaining cumulative-prefix amplification.
  - **Attempt:** Parse at a 256-character checkpoint and geometrically expand the next checkpoint, always parse the complete final buffer, and project JSON events to ordered deltas plus tool identity and final state.
    - **Outcome:** Worked
    - **Why:** Geometric checkpoints bound cumulative parse work, raw deltas preserve responsive partial updates, and the terminal message remains the lossless authoritative snapshot.
- **Root cause:** Cumulative snapshots were treated as incremental work units instead of mutable state that should be projected into compact deltas and finalized once.
- **Resolution:** OpenAI completions now checkpoint partial argument parsing adaptively without changing repetition detection or truncating ordinary generation; finalization reparses the full retained buffer. JSON print mode removes cumulative partial snapshots and retains ordered deltas plus tool-call identity.
- **Verification:** The OpenAI completion edge and repetition suites pass 19/19; the scaling regression asserts 7 parses, bounded cumulative parsed bytes, populated partial updates, and exact final arguments. The JSON projection regression bounds each update and proves exact reconstruction.
- **Prevention/follow-up:** Generalize bounded parsing separately to cumulative-delta paths in Anthropic, OpenAI Responses, Mistral, and Bedrock, and audit other stream consumers for repeated prefix serialization.
- **Reusable learning:** Never parse or serialize an ever-growing stream prefix per delta; emit compact ordered deltas, checkpoint partial views geometrically, and perform one complete lossless finalization.
- **References:** `packages/ai/src/providers/openai-completions/openai-streaming-blocks.ts`, `packages/ai/test/split-stream-edge-cases.test.ts`, `packages/coding-agent/src/modes/json-event-projection.ts`, `packages/coding-agent/test/print-mode-json-stream.test.ts`
