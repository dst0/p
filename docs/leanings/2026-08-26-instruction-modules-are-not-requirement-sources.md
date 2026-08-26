# 2026-08-26 — Instruction modules are not requirement sources

- **Status:** Resolved
- **Task/context:** Running a compiled-instruction canary that also froze a user-referenced operational specification before mutation.
- **Unexpected observation or failure:** After reading the correct rule module, the model tried to classify that module's clauses as delegated user requirements instead of calling `prepare_definition` for the sole listed specification candidate.
- **Evidence:** The controller repeatedly listed only `OPERATIONS.md` under `Candidates`, but its generic define-first rejection said to classify referenced sources without restating that `read_rules` modules belong to a separate instruction channel. The model then spent a long turn inventing source-clause mappings for the rule module.
- **Approaches tried:**
  - **Attempt:** Depend on the distinct `read_rules` and `record_requirement_audit` tool names to imply separate authority domains.
    - **Outcome:** Did not work
    - **Why:** After a rejected call, the local model reconstructed one combined notion of “referenced files” from both tool results.
  - **Attempt:** Repeat one canonical next action at the formatting, define-context, and mutation gates.
    - **Outcome:** Worked in focused tests
    - **Why:** Every rejection now says that only listed `Candidates` are requirement sources, rule modules remain execution instructions, and `prepare_definition` must precede `define`.
- **Root cause:** The tools kept separate runtime state, but their recovery prose did not explicitly preserve that authority boundary at the point where the model had to choose the next action.
- **Resolution:** Centralize requirement-source preparation guidance and reuse it in next-action formatting and define-first rejection; keep the mutation gate concise so the canonical guidance is not duplicated.
- **Verification:** Source-security, source-protocol liveness, and definition next-action suites pass. A post-fix live non-coding canary selected only `OPERATIONS.md`, recovered from one invalid overlapping selection, froze the source, completed the definition, and produced the correct operational artifact.
- **Prevention/follow-up:** Live-test every multi-tool authority boundary with a weaker model and make recovery messages state both what belongs to the channel and what explicitly does not.
- **Reusable learning:** Separate tool names do not establish a reliable authority boundary; repeat the boundary in the exact recovery message that selects the next tool.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-source-preparation-guidance.ts`, `packages/coding-agent/test/task-requirement-audit-source-security.test.ts`
