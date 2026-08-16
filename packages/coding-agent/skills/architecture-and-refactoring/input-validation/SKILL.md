---
name: input-validation
description: Engineering discipline of input validation, contract programming, error taxonomy, and trust boundary enforcement. Use when designing validation layers, error handling, or processing untrusted input.
---

# Input Validation and Defensive Programming

Input validation is a foundational engineering discipline concerned with ensuring that data entering a system or component meets expected formats, types, and constraints before being processed. Defensive programming extends this by anticipating failures and enforcing boundaries throughout the system architecture.

## Validation Layers

Robust systems implement validation at multiple, distinct layers:

1. **Transport Layer Validation**: Ensures the payload conforms to the expected transport protocol and size constraints. E.g., rejecting HTTP requests with `Content-Length` exceeding limits to prevent DoS.
2. **Schema Validation**: Validates the structural integrity and data types of the payload. Ensures fields are present, types match (e.g., string vs number), and basic formatting rules (e.g., regex for email).
3. **Domain Validation**: Validates the intrinsic properties of the domain object independent of external state. E.g., checking that a `StartDate` is before an `EndDate`.
4. **Business Rule Validation**: Involves external state or cross-aggregate rules. E.g., verifying a user has sufficient account balance before processing a transaction (requires DB lookup).

## Fail-Fast vs Accumulate-Errors

Two primary strategies dictate how validation failures are handled:

### Fail-Fast
The system aborts processing and returns an error immediately upon encountering the first validation failure.
- **Pros**: Simpler implementation, less resource consumption, prevents cascading failures.
- **Cons**: Poor user experience if submitting a form with multiple errors, as the user must fix them one by one.
- **Use Cases**: API endpoints (especially machine-to-machine), critical security checks, internal component boundaries.

### Accumulate-Errors
The system processes all validation rules, collects all failures, and returns them in a single batch.
- **Pros**: Better user experience for complex forms (e.g., UI validation).
- **Cons**: More complex implementation, potential for redundant processing.
- **Use Cases**: User-facing APIs, form submissions, bulk data imports.

## Core Concepts
- [Type Coercion and Boundaries](./type-coercion-and-boundaries.md)
- [Contract Programming](./contract-programming.md)
- [Error Taxonomy](./error-taxonomy.md)
- [Sanitization and Trust Boundaries](./sanitization-and-trust-boundaries.md)
