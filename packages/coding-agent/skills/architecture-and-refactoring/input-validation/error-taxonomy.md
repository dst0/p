# Error Taxonomy

A well-defined error taxonomy is critical for system observability, client integration, and incident response. Errors must be categorized to inform the appropriate resolution strategy.

## Error Categories

1. **User/Client Errors**: The caller provided invalid data, lacks authorization, or violated a business rule. The system is functioning correctly; the client must change their request.
2. **System/Infrastructure Errors**: Transience issues, database timeouts, network failures. The system is struggling; the client should typically retry (perhaps with backoff).
3. **Programming Bugs**: Null pointer exceptions, unhandled invariants. The code is broken and requires a developer fix.

## Protocol-Level Status Codes

### HTTP Status Codes
Mapping domain errors to HTTP semantic codes:
- **400 Bad Request**: Schema validation failure, malformed payload.
- **401 Unauthorized**: Missing or invalid authentication credentials.
- **403 Forbidden**: Authenticated, but lacks permissions (authorization).
- **404 Not Found**: Resource doesn't exist.
- **409 Conflict**: Domain/Business rule violation (e.g., unique constraint violation, concurrent update).
- **422 Unprocessable Entity**: Syntactically correct payload, but semantically invalid (often used for domain validation).
- **500 Internal Server Error**: Programming bugs, unhandled exceptions.
- **502/503/504**: Infrastructure failures (gateway errors, unavailable, timeouts).

### gRPC Status Codes
- `INVALID_ARGUMENT` (matches 400)
- `UNAUTHENTICATED` (matches 401)
- `PERMISSION_DENIED` (matches 403)
- `NOT_FOUND` (matches 404)
- `ALREADY_EXISTS`, `FAILED_PRECONDITION` (matches 409/422)
- `INTERNAL` (matches 500)
- `UNAVAILABLE` (matches 503)

## Domain Error Modeling

Errors should be modeled as first-class citizens in the domain language.

### Rust (Result Enum)
```rust
enum TransferError {
    InsufficientFunds,
    AccountSuspended,
    DailyLimitExceeded,
}

fn transfer(amount: u64) -> Result<(), TransferError> { ... }
```

### Go (Multiple Return Values)
```go
func Transfer(amount int) error {
    if amount <= 0 {
        return ErrInvalidAmount
    }
    // ...
}
```

## When to Throw vs Return vs Log
- **Throw (Exceptions)**: Use for programming bugs or truly exceptional, unrecoverable system states. Do not use for expected control flow (e.g., validation failures).
- **Return (Result/Error Types)**: Use for domain errors, validation failures, and expected failure modes (e.g., "User not found").
- **Log**: Log exceptions at the system boundary. Log domain errors at info/warn levels for analytics, but rely on returns for control flow.
