# Cargo Test Harness & Execution Patterns

Cargo's built-in test harness compiles tests into standalone binaries and executes test functions concurrently.

---

## 1. Unit Tests vs Integration Tests

```rust
// src/storage/wal.rs - In-file unit tests for internal invariants
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_wal_appends_and_recovers_cleanly() {
        let dir = tempdir().expect("Failed to create tempdir");
        let wal_path = dir.path().join("test.wal");

        let mut wal = WriteAheadLog::open(&wal_path).expect("open failed");
        wal.append(b"entry_1").expect("append failed");
        wal.flush().expect("flush failed");

        let recovered = WriteAheadLog::recover(&wal_path).expect("recover failed");
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].payload(), b"entry_1");
    }

    #[test]
    #[should_panic(expected = "CorruptedHeader")]
    fn test_rejects_corrupted_header() {
        let dir = tempdir().unwrap();
        let wal_path = dir.path().join("corrupted.wal");
        std::fs::write(&wal_path, b"garbage").unwrap();
        WriteAheadLog::open(&wal_path).unwrap();
    }
}
```

---

## 2. Command Flags & Concurrency Control

```bash
# Run tests with single thread for shared resource tests
cargo test -- --test-threads=1

# Run specific test with captured stdout output visible
cargo test test_wal_appends -- --nocapture

# Run ignored expensive integration tests
cargo test -- --ignored
```
