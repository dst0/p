# Error Handling with `thiserror` and `anyhow`

Rust provides two complementary libraries for clean error handling:
- **`thiserror`**: For structured, enumerated domain errors in libraries and core crates.
- **`anyhow`**: For flexible, context-rich error propagation in applications and binaries.

---

## 1. Domain Errors with `thiserror`

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("I/O failure while writing log: {0}")]
    Io(#[from] std::io::Error),

    #[error("Corrupted hash chain at sequence {seq}: expected {expected}, found {found}")]
    HashMismatch {
        seq: u64,
        expected: String,
        found: String,
    },

    #[error("Transaction rejected: fencing token {0} is stale")]
    StaleToken(u64),
}
```

---

## 2. Application Error Propagation with `anyhow`

```rust
use anyhow::{Context, Result};

pub fn initialize_subsystem(config_path: &str) -> Result<Subsystem> {
    let raw = std::fs::read_to_string(config_path)
        .with_context(|| format!("Failed to read configuration file at '{}'", config_path))?;
    
    let config = parse_config(&raw)
        .context("Invalid syntax in subsystem configuration")?;

    Ok(Subsystem::new(config))
}
```
