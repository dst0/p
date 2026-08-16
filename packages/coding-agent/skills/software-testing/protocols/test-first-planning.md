# Learning Unfamiliar Domains Before Implementation

When tasked with building something in a domain you haven't worked in before — whether it's a cryptographic protocol, a financial settlement engine, a distributed consensus algorithm, or a video codec — the worst thing you can do is start writing code immediately. The second worst thing is to rely solely on what you already know.

---

## 1. The Research-First Protocol

### Step 1: Identify What You Don't Know

Read the requirements carefully and list every term, concept, or constraint you're uncertain about. Be honest — overconfidence in unfamiliar domains produces subtly wrong implementations that pass basic tests but fail under real conditions.

Examples of things worth researching:
- "SHA-256 hash chain" — What exactly gets hashed? In what order? What's the canonical serialization?
- "Optimistic concurrency" — How does version checking work with batch operations?
- "SAGA pattern" — What are the compensation semantics? Does compensation run in reverse order?
- "CRDT" — Which CRDT type fits this use case? What are the merge semantics?

### Step 2: Search for Authoritative Sources

Formulate targeted search queries. Not vague ("how to do event sourcing") but specific:

```
# Good queries - specific to the exact problem
"JSONL append-only log SHA-256 hash chain canonical serialization"
"optimistic concurrency control batch transaction rollback"
"saga orchestration compensation reverse order timeout"
"idempotency key payload verification stripe aws pattern"

# Look for reference implementations
"event store implementation typescript github"
"workflow engine saga pattern reference implementation"

# Look for known pitfalls
"event sourcing common mistakes pitfalls"
"distributed transaction antipatterns"
```

Prioritize:
1. **Official specifications / RFCs** (e.g., RFC 7464 for JSON Text Sequences)
2. **Documentation of production systems** (Stripe API docs, AWS SDK docs, Kafka documentation)
3. **Well-maintained reference implementations** on GitHub with tests
4. **Conference talks and post-mortems** from companies that operate these systems at scale
5. **Academic papers** for algorithms (Raft, Paxos, CRDTs)

### Step 3: Extract Invariants and Edge Cases

From your research, extract a concrete list of invariants — properties that must ALWAYS hold:

```markdown
## Invariants I discovered:
1. Hash chain: each record's hash = SHA-256(previousHash + canonicalPayload)
2. Idempotency: same key + same payload = cached response; same key + different payload = error
3. Batch atomicity: if step N fails, steps 1..N-1 must have zero observable side effects
4. Version continuity: after restore from log, new operations continue from last version+1
5. Data integrity: truncated/corrupted log must be detected and rejected, never silently accepted
```

---

## 2. Plan Implementation with Tests First

### Write the test matrix before writing production code

This isn't TDD dogma — it's a practical strategy for domains you don't fully understand yet. Writing tests forces you to think through exact inputs, outputs, and error conditions before you get lost in implementation details.

```markdown
## Test plan:
### Happy path
- Basic lifecycle: create → mutate → query → verify state
- Round-trip: serialize → deserialize → verify equivalence

### Domain edge cases (from research)
- Boundary values specific to this domain
- Concurrent/conflicting operations
- Idempotent retry with identical and differing payloads

### Integrity and corruption
- What happens with truncated input?
- What happens with corrupted/tampered data?
- What happens with out-of-order or missing sequence numbers?

### Recovery
- Can the system be restored from its persistence format?
- Does a restored system behave identically to the original?
- Can a restored system continue operating (not just read-only)?
```

### Build modular, test continuously

1. Define types and interfaces first (these are your contract)
2. Implement the simplest module — the one with fewest dependencies
3. Run tests after each module
4. When tests fail, fix with minimal targeted edits — don't rewrite working modules

---

## 3. When to Search Again During Implementation

Research isn't a one-time phase. Return to search when:

- A test fails in a way you don't understand
- You discover a concept mid-implementation that wasn't in the original requirements
- Two design constraints seem to conflict
- You're about to make an architectural decision with no clear best choice
- Error messages reference specifications or standards you haven't read

The goal is not to memorize everything upfront but to know enough to build correctly and to recognize when you need to learn more.
