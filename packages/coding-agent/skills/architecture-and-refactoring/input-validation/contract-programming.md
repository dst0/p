# Contract Programming

Design by Contract (DbC), pioneered by Bertrand Meyer (Eiffel), is a methodology for designing software components by specifying formal, precise, and verifiable interface specifications.

## Core Concepts

### Preconditions
Conditions that must be true *before* a routine is called. The caller is responsible for meeting them. If a precondition fails, it's a bug in the *caller*.
```python
def withdraw(balance: float, amount: float):
    assert amount > 0, "Precondition failed: amount must be positive"
    assert balance >= amount, "Precondition failed: insufficient balance"
    # ...
```

### Postconditions
Conditions that the routine guarantees will be true *after* it executes, assuming preconditions were met. If a postcondition fails, it's a bug in the *routine*.
```python
def absolute_value(x: int) -> int:
    result = x if x >= 0 else -x
    assert result >= 0, "Postcondition failed: result must be non-negative"
    return result
```

### Class Invariants
Conditions that must be true for every instance of a class before and after every public method invocation.
```java
public class Account {
    private int balance;
    
    // Invariant: balance >= 0
    private void checkInvariant() {
        assert balance >= 0;
    }
}
```

## Assertions in Production vs Development
- **Development**: Heavy use of assertions catches bugs early.
- **Production**: Standard language `assert` statements are often disabled (e.g., Python `python -O`). In production, use robust validation frameworks or explicit checks that throw domain-specific exceptions, avoiding fatal crashes for non-critical invariants.

## Runtime Contract Validation Libraries
Modern ecosystems use declarative validation libraries to enforce contracts at runtime, especially at system boundaries (API inputs, DB reads).

- **TypeScript**: `zod`, `io-ts`, `typebox` (Parse, don't validate pattern).
- **Python**: `pydantic` (Data parsing and validation using type hints).
- **Rust**: `serde` (Serialization framework with validation hooks).

**Example: Zod (TypeScript)**
```typescript
import { z } from "zod";

const UserSchema = z.object({
  username: z.string().min(3).max(20),
  age: z.number().int().positive(),
});

// Parses and validates, stripping unknown fields
const user = UserSchema.parse(unknownInput); 
```
