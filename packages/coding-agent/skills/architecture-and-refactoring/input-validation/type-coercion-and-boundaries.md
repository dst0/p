# Type Coercion and Boundaries

Robust systems carefully manage data types at their edges to prevent overflow, precision loss, and unintended type coercion.

## Numeric Boundaries

### Integer Overflow
Languages like C, C++, Rust, and Java have fixed-size integers. Overflows can lead to catastrophic bugs (e.g., negative balances).
- **Mitigation**: Use checked arithmetic or larger types (e.g., 64-bit instead of 32-bit). In Rust, use `checked_add()`.

### Floating Point Precision
Floating-point numbers (IEEE 754) cannot perfectly represent all decimal fractions, leading to rounding errors.
- **Mitigation**: Never use floats for financial calculations. Use `BigDecimal` (Java), `decimal` (Python), or store as integers (e.g., cents) like Stripe does.

### BigInt
When dealing with exceptionally large numbers (e.g., database IDs like Snowflake IDs or cryptographic hashes), standard numbers in JS or JSON may lose precision.
- **Mitigation**: Represent as strings in JSON/transit, parse into BigInt constructs in memory.

## String Sanitization
- **Trimming**: Remove leading/trailing whitespace.
- **Normalization**: Unicode normalization (e.g., NFC) ensures consistent representation, crucial for string comparison (e.g., password hashing).
- **Encoding**: Ensure consistent encoding (e.g., UTF-8) to prevent injection via multi-byte characters.

## Collection Bounds
- **Empty Collections**: Handle empty arrays or sets gracefully.
- **Max Sizes**: Always enforce upper limits on array lengths or payload sizes to prevent memory exhaustion (OOM).

## Language-Specific Pitfalls

### JavaScript Type Coercion
JavaScript's loose equality (`==`) coerces types, leading to bugs.
```javascript
// Pitfall
"" == 0 // true
[] == 0 // true

// Mitigation
// Always use strict equality (===) and explicit type checking.
```

### Python Truthy/Falsy
Python evaluates empty collections, `None`, and `0` as falsy.
```python
# Pitfall
def process(items):
    if not items: # Fails for empty list AND None
        pass
        
# Mitigation
def process(items):
    if items is None:
        return
```

### Rust Option/Result
Rust forces explicit handling of missing values (`Option`) and errors (`Result`), eliminating Null Pointer Exceptions by design.
```rust
fn get_user(id: i32) -> Option<User> { ... }
```
