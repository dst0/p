# Rust Security Best Practices

Rust guarantees memory safety and thread safety at compile time for safe code, but security vulnerabilities can still arise from logic errors, `unsafe` blocks, and specific runtime behaviors.

## 1. Auditing and Minimizing `unsafe`

The `unsafe` keyword bypasses Rust's safety checks. It should be used sparingly and audited rigorously.
- **Isolate**: Contain `unsafe` blocks within safe, well-tested abstractions.
- **Document Safety Invariants**: Every `unsafe` block or `unsafe fn` must have a `// SAFETY: ...` comment explaining why the operation is sound and what invariants the caller must uphold.

**Bad Pattern**: Unnecessary unsafe code for slight performance gains.
```rust
// BAD: Pointer arithmetic without bounds checking
unsafe {
    let ptr = array.as_ptr();
    let val = ptr.add(idx).read(); 
}
```

**Secure Pattern**: Use idiomatic safe Rust.
```rust
// GOOD: Bounds-checked at runtime, safe
let val = array.get(idx).cloned();
```

## 2. Integer Overflow (CWE-190)

In Debug mode, Rust panics on integer overflow. In Release mode, it performs two's complement wrapping by default, which can lead to logic bugs (e.g., allocating a smaller buffer than expected).

**Secure Pattern**: Use explicit integer arithmetic methods when overflow is a possibility, especially with untrusted input (e.g., calculating buffer sizes from user-provided lengths).
```rust
// BAD: Wraps in release mode
let size = user_len * element_size;

// GOOD: Explicit handling
let size = user_len.checked_mul(element_size).ok_or(Error::Overflow)?;
// Or saturating_mul if clamping is desired
```

## 3. Cryptography & Secrets

- **Ecosystem**: Use robust crates like `ring` or the `RustCrypto` organization crates. Avoid rolling your own crypto.
- **Constant-Time Operations**: Use the `subtle` crate for constant-time comparisons to prevent timing attacks.
```rust
use subtle::ConstantTimeEq;
// GOOD: Constant-time comparison for MACs/Secrets
let is_valid = a.ct_eq(&b).into();
```
- **Secret Zeroization (CWE-14)**: Use the `secrecy` or `zeroize` crates to ensure sensitive data (passwords, keys) is overwritten in memory when dropped, preventing extraction from core dumps or compromised processes.
```rust
use secrecy::{SecretString, ExposeSecret};

let secret = SecretString::new("my_password".to_string());
// Memory is zeroed out when `secret` goes out of scope.
```

## 4. Concurrency and Data Races

While safe Rust prevents data races, logic races (race conditions) are still possible (e.g., TOCTOU - Time Of Check to Time Of Use in file systems).
When implementing `unsafe` types, carefully evaluate `Send` and `Sync` traits. Implementing them incorrectly on a type wrapping raw pointers breaks thread safety guarantees.

## 5. Supply Chain (CWE-1104)

- **cargo-audit**: Regularly run `cargo audit` to check `Cargo.lock` against the RustSec Advisory Database for vulnerabilities.
- **build.rs Risks**: `build.rs` scripts run at compile time with the permissions of the user compiling the code. Scrutinize `build.rs` in third-party crates for malicious behavior (e.g., network requests, arbitrary file execution).
