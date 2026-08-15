# Ecosystem Testing Adapters

This reference maps universal testing principles to idiomatic frameworks and tools across
major programming languages.

---

## Tooling Matrix

| Language | Primary Test Runner | Property-Based / Fuzzing | Mocking / Stubs | Temp Filesystem Fixture |
| :--- | :--- | :--- | :--- | :--- |
| **TypeScript / JS** | Vitest / Jest / Node test | `fast-check` | `vi.fn()` / `sinon` | `node:fs.mkdtemp` |
| **Python** | `pytest` | `hypothesis` | `unittest.mock` / `pytest-mock` | `tmp_path` fixture |
| **Rust** | `cargo test` / `nextest` | `proptest` / `cargo-fuzz` | `mockall` | `tempfile` crate |
| **Go** | `go test` | `testing/quick` / `gofuzz` | `gomock` / `testify/mock` | `t.TempDir()` |
| **C++** | `GoogleTest` / `Catch2` | `RapidCheck` / `libFuzzer` | `GoogleMock` | `std::filesystem::temp_directory_path` |

---

## Idiomatic Language Patterns

### 1. TypeScript / JavaScript
- **Property-based Invariants**: Use `fast-check` to generate hundreds of arbitrary inputs.
  ```typescript
  import fc from "fast-check";
  test("serialization roundtrip invariant", () => {
    fc.assert(
      fc.property(fc.record({ id: fc.string(), val: fc.integer() }), (obj) => {
        expect(deserialize(serialize(obj))).toEqual(obj);
      }),
    );
  });
  ```

### 2. Python
- **Pytest Fixtures**: Leverage `tmp_path` for ephemeral directory creation and clean teardown.
  ```python
  def test_atomic_file_write(tmp_path):
      target_file = tmp_path / "data.json"
      atomic_write(target_file, {"status": "ok"})
      assert target_file.read_text() == '{"status": "ok"}'
  ```

### 3. Rust
- **Result & Error Contracts**: Test custom error variants explicitly with pattern matching.
  ```rust
  #[test]
  fn test_invalid_header_rejection() {
      let result = parse_header(b"INVALID");
      assert!(matches!(result, Err(ParseError::InvalidHeader(_))));
  }
  ```

### 4. Go
- **Table-Driven Tests & Subtests**: Test matrix of edge cases with `t.Run`.
  ```go
  func TestEdgeCases(t *testing.T) {
      tests := []struct{ name, input string; wantErr bool }{
          {"empty", "", true},
          {"missing newline", "incomplete", true},
          {"valid", "valid\n", false},
      }
      for _, tt := range tests {
          t.Run(tt.name, func(t *testing.T) {
              err := Process(tt.input)
              if (err != nil) != tt.wantErr { t.Fatalf("unexpected error state") }
          })
      }
  }
  ```
