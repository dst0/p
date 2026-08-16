# Ownership and Copying Semantics

Managing state requires rigorous control over who "owns" the data and how data boundaries are drawn. When transferring data between components, understanding deep versus shallow copying is essential to prevent unintended reference sharing.

## Reference Sharing vs. Copying

**Reference sharing** passes a pointer to the existing state.
* *Safe when*: The data is deeply immutable, or the components are tightly coupled and strictly observe single-writer rules.
* *Dangerous when*: Passed to untrusted boundaries, background tasks, or stored across asynchronous boundaries where mutation might occur concurrently.

**Copying** duplicates the data, creating a new memory boundary.

## Shallow vs. Deep Copy

* **Shallow Copy**: Duplicates the top-level structure, but nested objects retain references to the original nested objects.
* **Deep Copy**: Recursively duplicates the entire structure. The new instance shares zero references with the original.

### JavaScript / TypeScript

JavaScript objects are passed by reference. Managing boundaries is a common challenge.

* **Shallow Copy**: `const clone = { ...original }` or `Object.assign({}, original)`
* **Deep Copy (Modern)**: `structuredClone(original)`. Natively supports circular references, Sets, Maps, and Dates, but strips functions.
* **Deep Copy (Legacy)**: `JSON.parse(JSON.stringify(original))`. Fast, but destroys Sets, Maps, Dates (turns to strings), and errors on circular references.

**Library Solutions**:
* **Immer**: Allows drafting next states using mutable syntax (`draft.x = 1`) while producing deeply immutable copies under the hood via Proxies.
* **Immutable.js**: Provides dedicated immutable data structures (Maps, Lists) rather than plain JS objects, enforcing safe boundaries.

### Python

Python variables are labels pointing to objects. 

* **Shallow Copy**: `copy.copy(obj)`, slicing `lst[:]`, or `list(lst)`.
* **Deep Copy**: `copy.deepcopy(obj)`.

**The `__copy__` / `__deepcopy__` Protocol**:
Classes can customize their copying behavior. This is critical for objects managing external state (e.g., file handles, database connections) which cannot or should not be duplicated.

```python
import copy

class ConnectionWrapper:
    def __init__(self, db_conn, query_cache):
        self.db_conn = db_conn
        self.query_cache = query_cache
        
    def __deepcopy__(self, memo):
        # Do not deepcopy the database connection, share the reference
        # But do deepcopy the cache to prevent cross-contamination
        new_wrapper = type(self)(
            self.db_conn,
            copy.deepcopy(self.query_cache, memo)
        )
        return new_wrapper
```

### Rust

Rust enforces ownership at compile time, eliminating a massive class of state bugs.

* **Move Semantics**: By default, assignment transfers ownership. The original variable becomes invalid.
* **Copy Trait**: For simple bitwise-copyable types (integers, floats), assignment copies the value.
* **Clone Trait**: Explicitly requests a deep copy (`data.clone()`). Can be expensive.

**Advanced Ownership Types**:
* `Cow<'a, T>` (Clone-on-Write): A smart pointer that encapsulates either a borrowed reference or an owned value. It defers cloning until a mutation is actually required. Highly efficient for parsing and string manipulation.
* `Arc<T>` (Atomic Reference Counted): Allows thread-safe shared ownership of immutable data. 

## Performance Implications

Aggressive deep copying degrades performance through high allocation latency and garbage collection pauses.

**Strategies for mitigation**:
1. **Copy-on-Write (CoW)**: Operating systems use CoW for process forking (e.g., Redis background saves). Libraries (like immer) use it for state trees.
2. **Arena Allocation**: Grouping object lifecycles together so copying and deallocation happen in bulk.
3. **Structural Sharing**: Using trees where a "copy" only duplicates the path to the changed leaf, sharing the rest of the tree with the original (see Functional Patterns).
