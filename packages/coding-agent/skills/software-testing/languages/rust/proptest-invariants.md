# Proptest Invariant Verification & Shrinking

Property-based testing with `proptest` generates hundreds of randomized inputs to discover edge cases that hand-written tests miss.

---

## 1. Property-Based Assertion Pattern

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_encoding_decoding_roundtrip(val in any::<Vec<u8>>()) {
        let encoded = encode_payload(&val);
        let decoded = decode_payload(&encoded).expect("Decoding must never fail on valid encoded bytes");
        prop_assert_eq!(val, decoded);
    }

    #[test]
    fn test_monotonic_sequence_generator(steps in 1usize..100) {
        let mut gen = MonotonicSequence::new(10);
        let mut last = 10;
        for _ in 0..steps {
            let next = gen.next_id();
            prop_assert!(next > last);
            last = next;
        }
    }
}
```

---

## 2. Invariant State Machine Testing

To test complex stateful components (e.g. KV stores, B-Trees, Saga state machines):
1. Define an enum of operations: `enum Op { Put(String, Vec<u8>), Delete(String), Compact }`.
2. Generate arbitrary vectors of `Op`.
3. Apply operations in parallel to the system under test and a naive reference model (e.g. `std::collections::HashMap`).
4. Assert state equality after every transition.
