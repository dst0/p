# The 4-Module Separation Pattern

To maintain clean separation of concerns and avoid bloated monolithic files, organize feature domains into 4 distinct layers:

```
┌────────────────────────────────────────────────────────┐
│ 1. Types Layer       (types.ts, models.ts)             │
│    - Pure interfaces, type definitions, zero logic     │
├────────────────────────────────────────────────────────┤
│ 2. Storage / State   (store.ts, repository.ts)         │
│    - Persistence, in-memory cache, pure data access    │
├────────────────────────────────────────────────────────┤
│ 3. Operations / Core (engine.ts, coordinator.ts)       │
│    - Business logic, orchestration, algorithms         │
├────────────────────────────────────────────────────────┤
│ 4. Presentation / I/O(cli.ts, component.ts, api.ts)    │
│    - Terminal I/O, HTTP endpoints, view rendering      │
└────────────────────────────────────────────────────────┘
```

---

## Dependency Direction Invariant

Dependencies must strictly point **downward**:
`Presentation -> Operations -> Storage -> Types`

- `Types` never imports from any other layer.
- `Storage` never imports from `Operations` or `Presentation`.
- `Operations` never imports from `Presentation`.
