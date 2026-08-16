# Line-Delimited Formats

Line-delimited formats are the workhorse of streaming data processing, log aggregation, and large-scale data exports. Their defining characteristic is that each line (separated by a newline character) represents an independent, self-contained record.

## 1. JSON Lines (JSONL / NDJSON)

**Real-world context:** Used by Elasticsearch bulk APIs, AWS Kinesis firehose, Docker logging, and BigQuery data ingestion.

**Format:** Each line is a valid JSON object. `\n` or `\r\n` separates objects.

```jsonl
{"level": "info", "ts": 1678888000, "msg": "Server started"}
{"level": "error", "ts": 1678888005, "msg": "DB timeout", "trace_id": "a1b2"}
```

**Pros & Cons:**
*   **Pros:** Append-only friendly, easily split for parallel processing (Hadoop/Spark), schema-less flexibility.
*   **Cons:** Higher parsing overhead than CSV, redundant key names on every line.

**Pitfalls:**
*   **Newlines within fields:** JSON allows `\n` inside string values. Parsers must ensure they don't break lines prematurely. (JSON stringifies `\n` as `\n`).
*   **Framing & Delimiter Integrity (The `trim()` Trap):** In strict line-delimited protocols, every record must be terminated with `\n`. Applying `text.trimEnd()` or `text.trim()` before splitting strips trailing delimiters, making it impossible to distinguish between a fully delivered record and a truncated/partial stream cut off midway through the wire. When validating data streams, check that the buffer ends with the expected record delimiter before parsing.
*   **Empty lines:** The spec allows empty lines, but strict parsers might choke. Always validate whether empty lines are permitted in the protocol.

## 2. CSV / TSV (Comma/Tab-Separated Values)

**Real-world context:** Universal format for spreadsheet data, database exports (PostgreSQL `COPY`), and traditional data integration.

**Pitfalls & Parsing Complexity:**
*   CSV is deceptively complex. **Never use `.split(',')`.** Use a robust CSV parser.
*   **Quoting:** Fields with commas, newlines, or quotes must be wrapped in quotes. `John, "Doe, Jr.", 30`.
*   **Escaping Quotes:** Inside a quoted field, a quote is escaped by doubling it (RFC 4180): `"He said, ""Hello"""`.
*   **Delimiter Conflicts:** TSV (tabs) is often safer than CSV if the data contains text, as tabs are rare in normal text, reducing the need for complex quoting.

```python
import csv

# Writing robust CSV
with open('data.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(['Name', 'Notes'])
    writer.writerow(['Alice', 'Line 1\nLine 2']) # Handles the newline safely
```

## 3. Server-Sent Events (SSE)

**Real-world context:** Real-time updates over HTTP (e.g., ChatGPT streaming responses, stock tickers).

**Format:** A continuous HTTP response stream. Messages are separated by double newlines (`\n\n`). Each message consists of `field: value` lines.

```http
data: {"user": "alice", "action": "join"}

event: custom_event
data: {"status": "ok"}
```

**Pitfalls:**
*   **Buffering:** Proxies (Nginx) or HTTP clients might buffer the stream waiting for a large chunk or EOF, destroying the real-time nature. You must disable buffering via headers (e.g., `X-Accel-Buffering: no`) and flush explicitly.
*   **Partial Reads:** The network can deliver a partial message. Parsers must buffer incomplete chunks until the `\n\n` boundary is reached.

## 4. Streaming vs. Batch Consumption

When processing line-delimited files, **never read the entire file into memory** (`fs.readFileSync`). Use streaming abstractions.

**TypeScript (Node.js) Streaming JSONL:**
```typescript
import * as fs from 'fs';
import * as readline from 'readline';

async function processLogStream(filePath: string) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    
    // readline handles the buffering and newline splitting
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity // Treats \r\n and \n equivalently
    });

    for await (const line of rl) {
        if (!line.trim()) continue; // Skip empty lines
        try {
            const record = JSON.parse(line);
            // Process record...
        } catch (err) {
            console.error(`Malformed JSON line: ${line}`);
        }
    }
}
```
