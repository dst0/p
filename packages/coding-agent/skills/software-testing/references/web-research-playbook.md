# Web Research Playbook for Testing & Implementation

This playbook guides the agent on how to use web search to discover testing best practices,
edge cases, and ecosystem standards before implementing code or designing test suites.

---

## When Web Search is Mandatory

Execute a web search whenever:
1. **Integrating Third-Party Libraries or APIs**: Discover unexpected failure modes, error
   codes, retry semantics, and lifecycle hooks.
2. **Handling Asynchronous Concurrency & Cancellation**: Investigate how the specific runtime
   handles `AbortSignal`, cancellation propagation, timeouts, and resource leaks.
3. **Designing Test Doubles & Harnesses**: Check how the framework community recommends
   testing the component (e.g. testing subprocesses, streaming responses, or database sessions).
4. **Encountering Ambiguous Error Messages or Platform Differences**: Cross-platform behavior
   differences across Linux, macOS, and Windows.

---

## Effective Search Query Templates

Structure queries using exact keywords, current technology versions, and concrete domain concepts:

| Goal | Search Query Pattern | Example |
| :--- | :--- | :--- |
| **Framework Testing Practices** | `"<library>" testing best practices <framework>` | `"vitest" testing AbortSignal mock best practices` |
| **Error & Edge Case Discovery** | `"<library>" common bugs edge cases "<function/method>"` | `"node child_process" spawn buffer overflow edge cases` |
| **Cancellation & Cleanup** | `"<framework>" cancel in-flight request graceful shutdown` | `"fetch" AbortController memory leak event listener cleanup` |
| **Property & Mutation Testing** | `"<language>" mutation testing property-based testing examples` | `"typescript" fast-check property based testing invariants` |
| **Cross-Platform I/O Quirks** | `"<language>" atomic file write cross platform windows mac` | `"node:fs" atomic write rename ENOENT cross-device link` |

---

## Evaluation Checklist for Search Results

When analyzing search results:
- **Prioritize Official Specs & RFCs**: Check official API documentation, WHATWG/W3C specs,
  and framework issue trackers.
- **Check Issue Trackers for Known Bugs**: Search GitHub issues (e.g. `site:github.com/<org>/<repo>/issues "error"`)
  for reports of race conditions or platform-specific failures.
- **Extract Concrete Invariants**: Convert findings into specific test assertions (e.g.,
  "Ensure event listeners are unregistered when signal is aborted").
- **Discard Outdated Workarounds**: Look for standard native primitives (e.g., `AbortSignal.any()`,
  `fs.promises`) rather than legacy third-party patches.
