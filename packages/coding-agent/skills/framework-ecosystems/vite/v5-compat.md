# Vite 5 Compatibility & Configuration

Vite 5 migrated the bundler backend to Rollup 4 and standardized worker module formats.

---

## 1. Single Server/SSR Configuration

In Vite 5, SSR and client builds were configured sequentially or via `build.ssr`:

```typescript
// vite.config.ts (Vite 5 style)
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
```
