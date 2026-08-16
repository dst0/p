# Pytest Fixtures, Scopes & Isolation

Pytest fixtures provide dependency injection and deterministic teardown for test functions.

---

## 1. Fixture Scoping & Teardown

```python
import pytest
import tempfile
import shutil
from pathlib import Path

@pytest.fixture(scope="function")
def isolated_storage(tmp_path: Path):
    """Provides an isolated database storage directory per test function."""
    db_file = tmp_path / "test_store.db"
    store = StorageEngine(str(db_file))
    store.initialize()
    
    yield store
    
    # Teardown logic executes after the test completes
    store.close()
```

---

## 2. Parametrization Matrix

Test multiple permutations with `@pytest.mark.parametrize`:

```python
@pytest.mark.parametrize(
    "raw_input,expected_output",
    [
        ("simple-key", "simple-key"),
        ("UPPERCASE_KEY", "uppercase-key"),
        ("with spaces and special!", "with-spaces-and-special"),
        ("---excessive-hyphens---", "excessive-hyphens"),
    ],
)
def test_key_slugification(raw_input: str, expected_output: str):
    assert slugify_key(raw_input) == expected_output
```
