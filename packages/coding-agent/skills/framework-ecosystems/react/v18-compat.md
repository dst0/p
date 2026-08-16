# React 18 Compatibility & Concurrent Features

React 18 introduced concurrent rendering, automatic batching, and transition priorities.

---

## 1. `forwardRef` in React 18

In React 18 and earlier, passing refs to function components requires wrapping with `forwardRef`:

```tsx
import { forwardRef } from "react";

export const LegacyTextInput = forwardRef<HTMLInputElement, { label: string }>(
  ({ label }, ref) => {
    return (
      <label>
        {label}
        <input ref={ref} />
      </label>
    );
  }
);
```

---

## 2. Non-Urgent Updates with `startTransition`

```tsx
import { useState, useTransition } from "react";

export function SearchFilter() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Urgent update (keeps input responsive)
    setQuery(e.target.value);

    // Non-urgent update (can be interrupted by further keystrokes)
    startTransition(() => {
      setResults(filterLargeDataset(e.target.value));
    });
  }

  return (
    <div>
      <input value={query} onChange={handleChange} />
      {isPending && <p>Filtering...</p>}
      <ul>{results.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}
```
