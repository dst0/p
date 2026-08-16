# Fixture Isolation & Environment Protocol

Shared state between tests is the primary source of test flakiness, race conditions, and false positives.

---

## 1. Hermetic Test Environments

Each test must run in total isolation from all other tests and from the developer's host environment.

### Rules of Fixture Isolation
1. **Ephemeral Filesystem Fixtures**: Never write to relative paths or shared global folders. Always allocate a dedicated temporary directory (`mkdtempSync` in Node, `tempfile.TemporaryDirectory` in Python, `tempfile::TempDir` in Rust) per test run.
2. **Deterministic Cleanup**: Register robust cleanup hooks (`afterEach` / `defer` / `Drop`) to remove temporary directories, clear sockets, and terminate background child processes.
3. **Environment Variable Scoping**: Snapshot `process.env` before tests, override only required keys within test boundaries, and restore exact snapshots during teardown.
4. **Zero Shared In-Memory Registries**: Avoid module-level static singletons or global caches. Instantiate instances explicitly per test or clear all registry state in `beforeEach`.

---

## 2. Real vs Mock Isolation Patterns

Prefer lightweight real implementations over deep mock networks:

```typescript
// Antipattern: Brittle deep mocks
const fsMock = {
  readFileSync: vi.fn().mockReturnValue('{"version": 1}'),
  writeFileSync: vi.fn(),
};

// Recommended: Hermetic ephemeral filesystem fixture
describe("ConfigStore", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
    configPath = join(tempDir, "config.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles concurrent writes atomically", async () => {
    const store = new ConfigStore(configPath);
    await store.write({ key: "val" });
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({ key: "val" });
  });
});
```
