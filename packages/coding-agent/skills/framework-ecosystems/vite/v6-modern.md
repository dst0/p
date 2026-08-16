# Vite 6 Modern Architecture (Default)

Vite 6 introduces the Environment API, enabling unified builds across multiple target execution environments (browser, Node SSR, edge runtimes, Cloudflare workerd).

---

## 1. Multi-Environment Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  environments: {
    client: {
      build: {
        outDir: "dist/client",
      },
    },
    ssr: {
      build: {
        outDir: "dist/server",
        ssr: true,
      },
    },
    edge: {
      resolve: {
        conditions: ["worker", "browser"],
      },
    },
  },
});
```

---

## 2. Fast Refresh & Module Graph Inspection

Vite 6 provides enhanced HMR invalidation tracing and memory leak diagnostics for large component graphs.
