# Transactional State

Modifying complex state often requires multiple steps. If a failure occurs mid-operation (network timeout, disk full, process crash), the system must not be left in an inconsistent partial state. Transactional patterns ensure reliable state transitions.

## The ACID Properties

Rooted in database theory but applicable to application state design:
* **Atomicity**: All operations in the sequence succeed, or none do. "All or nothing."
* **Consistency**: The transaction transitions the system from one valid state to another valid state, enforcing invariants.
* **Isolation**: Concurrent transactions do not observe each other's partial updates.
* **Durability**: Once committed, the state survives system crashes.

## Staging and the Unit-of-Work Pattern

To achieve atomicity in application code, avoid mutating long-lived domain objects directly during business logic execution.

The **Unit-of-Work** pattern stages changes in a temporary buffer. Business logic applies mutations to this isolated buffer. Only when all operations succeed is the buffer committed to the actual durable state store or shared memory.

```python
class UnitOfWork:
    def __init__(self, repository):
        self.repo = repository
        self.staged_inserts = []
        
    def add(self, entity):
        self.staged_inserts.append(entity)
        
    def commit(self):
        # Atomic commit to the underlying data store
        self.repo.bulk_insert(self.staged_inserts)
        self.staged_inserts.clear()
```

## Write-Ahead Logging (WAL)

Used by robust state machines (Kafka, ZooKeeper, PostgreSQL). Before applying a state mutation to memory or disk files, the system appends the *intent* to mutate to an append-only sequential log (the WAL). 

If the system crashes during the actual mutation, upon reboot, it reads the WAL and replays the incomplete operations. This guarantees durability and atomicity with high sequential write performance.

## Distributed Transactions and Sagas

When a state change spans multiple independent services or databases, standard local transactions fail.

### Two-Phase Commit (2PC)
A coordinator asks all participants to prepare to commit (Phase 1). If all agree and lock their resources, the coordinator commands them to commit (Phase 2).
* *Pros*: Strong consistency.
* *Cons*: Blocking, high latency, very fragile to network partitions.

### Sagas / Compensation
Instead of global locks, a Saga breaks the distributed transaction into a series of local transactions. Each step publishes an event to trigger the next. If a step fails, the Saga executes **compensating transactions**—explicit operations that undo the previous steps (e.g., if "Charge Credit Card" succeeds but "Reserve Inventory" fails, execute "Refund Credit Card").

This is the standard approach in microservices (e.g., Stripe, AWS Step Functions) where strict ACID is sacrificed for high availability (BASE: Basically Available, Soft state, Eventual consistency).

## Software Transactional Memory (STM)

An alternative to locking for in-memory concurrency. Threads execute operations inside an `atomic` block. The STM tracks memory reads and writes. Upon completion, it attempts to commit. If another thread mutated the underlying memory in the meantime, the STM aborts the transaction, rolls back the local changes, and automatically retries.

Clojure and Haskell utilize STM to coordinate complex changes across independent immutable references safely.
