---
name: distributed-systems-saga-orchestration
description: "Saga orchestration patterns: DAG scheduling, distributed lease fencing, and reverse compensating rollbacks."
---

# Saga Orchestration Architecture Guide

Sagas coordinate long-running distributed transactions across multiple microservices or subsystems without holding blocking two-phase commit (2PC) locks.

---

## Direct Navigation

- [Topological DAG Scheduling](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/dag-scheduling/topological-determinism.md)
- [Fencing Tokens & Distributed Leases](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/leasing/fencing-tokens.md)
- [Compensating Reverse Rollback](file:///packages/coding-agent/skills/distributed-systems/saga-orchestration/compensation/reverse-rollback.md)
