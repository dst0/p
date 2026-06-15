---
name: easy-edit
description: Use these position-based editing tools when precise, deterministic file modifications are needed without the fragility of text-matching.
---

# easy-edit

Position-based file editing tools that avoid text-matching fragility.  
Every mutation (except `easy:revert`) creates a timestamped backup in `.pi/edits/` with project paths preserved.

## When to use

- You need **precise, deterministic** edits without quoting or escaping file content.
- The `edit` tool fails because `oldText` doesn't match exactly (whitespace, encoding, etc.).
- You're doing programmatic/repeated edits where line/column math is easier than string matching.
- You need to **copy**, **paste**, or **insert** text at exact positions.

## Workflow

1. **`easy:find`** — Locate the text you need to edit. Returns exact `{line, position}` for start and end of each match.
2. **`easy:copy`** — Copy a text region to clipboard (by position). Use `start` + `end`, or `start` + `length`.
3. **`easy:replace`** — Replace text at a position. Use `start` + `end`, or `start` + `length`. Pass `text` for the replacement.
4. **`easy:insert`** — Insert text at a position. Shifts existing content — nothing is removed.
5. **`easy:paste`** — Paste previously copied text at a position.
6. **`easy:revert`** — Restore the file from its most recent backup (one step back). Call again for earlier versions.

## Tools

### `easy:find`

Find occurrences of literal text in a file. Returns `{file, start, end, length}` for each match.

```json
{ "file": "src/main.ts", "pattern": "function foo", "maxResults": 10 }
```

### `easy:copy`

Copy text from a file region to an internal clipboard. Creates a backup.

```json
{
  "file": "src/main.ts",
  "start": { "line": 5, "position": 0 },
  "end": { "line": 5, "position": 20 }
}
```

or with length:

```json
{ "file": "src/main.ts", "start": { "line": 5, "position": 0 }, "length": 20 }
```

### `easy:replace`

Replace a text region with new text. Creates a backup.

```json
{
  "file": "src/main.ts",
  "start": { "line": 5, "position": 0 },
  "end": { "line": 5, "position": 20 },
  "text": "new content"
}
```

or with length:

```json
{
  "file": "src/main.ts",
  "start": { "line": 5, "position": 0 },
  "length": 20,
  "text": "new content"
}
```

### `easy:insert`

Insert text at `{line, position}`. Shifts existing content — nothing is removed. Creates a backup.

```json
{
  "file": "src/main.ts",
  "start": { "line": 5, "position": 0 },
  "text": "inserted text\n"
}
```

### `easy:paste`

Paste previously copied text (from `easy:copy`) at `{line, position}`. Creates a backup.

```json
{ "file": "src/main.ts", "start": { "line": 5, "position": 0 } }
```

### `easy:revert`

Revert a file to its most recent backup (one step back). Does not create a new backup.

```json
{ "file": "src/main.ts" }
```

## Position notes

- **Lines are 1-indexed** (line 1 = first line of file)
- **Positions are 0-indexed** (position 0 = first character of line)
- Use `easy:find` first to get exact positions — don't guess coordinates
- `length` is an alternative to `end` — counts characters from `start`
