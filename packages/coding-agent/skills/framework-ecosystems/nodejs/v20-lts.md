# Node.js v20 LTS Compatibility & Foundation

Node.js v20 established core web standards and modern ESM loader hooks.

---

## 1. Stable Fetch & Web Streams

Node.js v20 provides stable global `fetch`, `Headers`, `Request`, `Response`, and `ReadableStream` / `WritableStream`.

```typescript
const response = await fetch("https://api.example.com/health");
const data = await response.json();
```

---

## 2. ESM Custom Loader Hooks

In Node.js v20+, custom module resolution uses `module.register()`:

```typescript
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./custom-loader.js", pathToFileURL("./"));
```
