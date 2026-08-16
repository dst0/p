# 300-Line Physical Limits & Refactoring Protocols

Files must contain at most **300 physical lines** to maximize readability, maintainability, and cognitive clarity.

---

## 1. File Splitting Invariants

1. **One Primary Runtime Entity Per File**: A single class, state machine, or main coordinator per file. Supporting types may reside in the file or in `types.ts`.
2. **Descriptive Split Names**: Split by domain responsibility (e.g. `discovery.ts`, `formatting.ts`, `validation.ts`). Never create generic `part1.ts`, `part2.ts`, or `utils2.ts`.
3. **Zero Circular Delegation**: Never create self-recursive forwarding between split files.
4. **Behavior-Preserving Refactor**:
   - Establish clean test baseline before refactoring.
   - Execute file split.
   - Run type checker and test suite to confirm zero regressions.
