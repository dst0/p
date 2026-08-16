# Functional Immutability Patterns

Functional programming treats state not as a place in memory that changes, but as a sequence of discrete values over time. This paradigm relies heavily on specialized data structures and architectures.

## Structural Sharing and Persistent Data Structures

If we must copy a data structure on every update to maintain immutability, performance collapses. Functional languages solve this using **Persistent Data Structures**. 

When a modification occurs, the new version shares most of its structure with the old version. 
* **Tries and HAMTs (Hash Array Mapped Tries)**: Used for immutable Maps and Sets. A tree is constructed based on the hash of the keys. An update creates new nodes only along the path from the root to the modified leaf. All other branches are shared between the old and new version.
* **Lists**: Linked lists trivially support structural sharing. Appending to the head creates a new node pointing to the existing list.

This allows $O(\log_{32} n)$ time complexity for updates while using minimal memory per new version.

## Lenses and Optics

Updating deeply nested immutable structures is syntactically cumbersome:

```javascript
// Painful vanilla JS deep update
const nextState = {
  ...state,
  user: {
    ...state.user,
    profile: {
      ...state.user.profile,
      age: state.user.profile.age + 1
    }
  }
}
```

**Lenses** (or Optics) are composable functional abstractions that encapsulate the "getter" and "setter" logic for a specific path in a data structure, allowing elegant deep updates without mutating the original.

## Event Sourcing

Instead of storing the *current state*, Event Sourcing stores the *sequence of immutable events* that led to the current state.

State is derived by reducing (folding) the events:
`Current State = Initial State + Event 1 + Event 2 + ...`

* **Pros**: Unparalleled auditability (you have the entire history of exactly what happened), temporal queries ("what did the system look like last Tuesday?"), and trivial undo/redo capabilities. Used heavily in finance, billing systems, and event streams (Kafka).
* **Cons**: Eventually requires snapshotting to avoid replaying millions of events on startup.

## CQRS (Command Query Responsibility Segregation)

Often paired with Event Sourcing. CQRS separates the models and APIs used for mutating state (Commands) from those used for reading state (Queries).

* **Command Side**: Handles business logic, validation, and appending immutable events. Highly normalized.
* **Query Side**: Subscribes to events and projects them into highly denormalized read models (e.g., materialized views in Elasticsearch or Redis) optimized purely for fast reading.

## The Redux / Elm Architecture

A pervasive pattern for UI state management that embodies functional principles:

1. **State**: A single, deeply immutable tree holding the entire application state.
2. **Actions (Events)**: Immutable objects describing something that happened (e.g., `{ type: 'ITEM_ADDED', payload: { id: 1 } }`).
3. **Reducers**: Pure functions of the signature `(currentState, action) => nextState`. They calculate the new state tree using structural sharing.

Because the state tree is immutable, UI frameworks can use extremely fast shallow equality checks (`oldState.user === newState.user`) to determine if a subtree needs to be re-rendered.
