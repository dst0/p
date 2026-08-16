# Hypothesis Property-Based Testing in Python

Hypothesis is a powerful property-based testing framework that generates structured random data and automatically shrinks failing cases.

---

## 1. Defining Invariant Properties

```python
from hypothesis import given, strategies as st
from myapp.encoder import encode_message, decode_message

@given(st.text(min_size=0, max_size=1000), st.integers(min_value=0, max_value=2**32 - 1))
def test_message_roundtrip(content: str, seq: int):
    """Assert roundtrip decoding restores the exact original message and sequence."""
    payload = {"content": content, "sequence": seq}
    encoded = encode_message(payload)
    decoded = decode_message(encoded)
    
    assert decoded == payload
```

---

## 2. Stateful Rule-Based Testing

Hypothesis supports `RuleBasedStateMachine` for exercising complex multi-step state machines:

```python
from hypothesis.stateful import RuleBasedStateMachine, rule, invariant

class DatabaseStateMachine(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.model = {}
        self.db = RealDatabase()

    @rule(key=st.text(), value=st.binary())
    def put(self, key, value):
        self.model[key] = value
        self.db.set(key, value)

    @rule(key=st.text())
    def delete(self, key):
        self.model.pop(key, None)
        self.db.delete(key)

    @invariant()
    def check_parity(self):
        for k, v in self.model.items():
            assert self.db.get(k) == v

TestDatabase = DatabaseStateMachine.to_runner()
```
