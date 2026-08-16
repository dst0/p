# Node.js v22–v26+ Modern Architecture

Modern Node.js (v22+) eliminates build tool friction with native TypeScript support, integrated SQLite, and web-standard WebSockets.

---

## 1. Native TypeScript Execution

Run `.ts` files directly without ts-node or build steps:

```bash
node --experimental-strip-types src/index.ts
```

---

## 2. Built-in `node:sqlite`

Execute embedded SQL databases without native binary dependencies:

```typescript
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    payload TEXT
  ) STRICT;
`);

const insert = database.prepare("INSERT INTO events (key, payload) VALUES (?, ?)");
insert.run("user_1", JSON.stringify({ action: "login" }));

const query = database.prepare("SELECT * FROM events WHERE key = ?");
const rows = query.all("user_1");
```

---

## 3. Native WebSockets

Client WebSockets are available globally:

```typescript
const ws = new WebSocket("wss://api.example.com/stream");
ws.addEventListener("message", (event) => {
  console.log("Received:", event.data);
});
```
