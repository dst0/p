# Rust Newtype Pattern & Trait Composition

The Newtype pattern wraps an existing type in a single-element tuple struct, enforcing distinct semantics with zero runtime overhead.

---

## 1. The Newtype Pattern

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionId(String);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TaskId(String);

impl SessionId {
    pub fn new(id: impl Into<String>) -> Result<Self, &'static str> {
        let val = id.into();
        if !val.starts_with("sess_") {
            return Err("Invalid session id prefix");
        }
        Ok(Self(val))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
```

---

## 2. Trait Composition & Send + Sync

For distributed systems and multi-threaded runtimes:

```rust
pub trait StorageBackend: Send + Sync + 'static {
    fn put(&self, key: &str, value: &[u8]) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, Box<dyn std::error::Error + Send + Sync>>;
}
```
