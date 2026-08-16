---
name: distributed-systems
description: Architecture, deterministic storage, saga orchestration, event sourcing, and transaction safety protocols for distributed systems.
---

# Distributed Systems Architecture & Reliability Standard

This skill is the multi-tier engineering authority for building deterministic, fault-tolerant, and transactionally safe distributed systems.

---

## 1. Multi-Tier Skill Navigation

```
distributed-systems/
├── SKILL.md
├── event-sourcing/
│   ├── SKILL.md
│   ├── storage/
│   │   ├── deterministic-jsonl.md
│   │   └── hash-chaining-sha256.md
│   └── state-reconstruction/
│       └── replay-tamper.md
├── saga-orchestration/
│   ├── SKILL.md
│   ├── dag-scheduling/
│   │   └── topological-determinism.md
│   ├── leasing/
│   │   └── fencing-tokens.md
│   └── compensation/
│       └── reverse-rollback.md
└── transaction-safety/
    ├── SKILL.md
    ├── idempotency/
    │   └── command-key-registry.md
    └── isolation/
        └── copy-on-write.md
```

---

## 2. Core Pillars & Direct Links

### Pillar 1: Event-Sourcing & Deterministic Logs
- [Event Sourcing Architecture](file:///packages/coding-agent/skills/distributed-systems/event-sourcing/SKILL.md)
  - [Deterministic JSONL Storage](file:///packages/coding-agent/skills/distributed-systems/event-sourcing/storage/deterministic-jsonl.md): Append-only records, strict newline framing, atomic buffer flushing, and compaction.
  - [SHA-256 Hash Chaining](file:///packages/coding-agent/skills/distributed-systems/event-sourcing/storage/hash-chaining-sha256.md): Cryptographically linked ledger, rolling digests, and tamper evidence.
  - [State Reconstruction & Replay](file:///packages/coding-agent/skills/distributed-systems/event-sourcing/state-reconstruction/replay-tamper.md): Deterministic fold/reduce state projection, snapshotting, and corruption rejection.

### Pillar 2: Saga Orchestration & Coordination
- [Saga Orchestration Architecture](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/SKILL.md)
  - [Topological DAG Scheduling](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/dag-scheduling/topological-determinism.md): Acyclic dependency resolution, parallel branch execution, and deterministic sequencing.
  - [Fencing Tokens & Distributed Leases](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/leasing/fencing-tokens.md): Monotonic fencing tokens, lease expiry handling, and split-brain suppression.
  - [Compensating Reverse Rollback](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/compensation/reverse-rollback.md): Strict reverse-order compensation, partial failure handling, and idempotent rollback actions.

### Pillar 3: Transaction Safety & Isolation
- [Transaction Safety Architecture](file:///packages/coding-agent/skills/distributed-systems/transaction-safety/SKILL.md)
  - [Command Idempotency Key Registry](file:///packages/coding-agent/skills/distributed-systems/transaction-safety/idempotency/command-key-registry.md): Duplicate elimination, deduplication windows, and in-flight request deduplication.
  - [Copy-on-Write Snapshot Isolation](file:///packages/coding-agent/skills/distributed-systems/transaction-safety/isolation/copy-on-write.md): In-memory transaction isolation, atomic commits, and safe rollbacks.
