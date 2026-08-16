# Binary Data Formats

Binary formats are optimized for machine-to-machine communication and compact storage. They prioritize encoding/decoding speed, payload size, and schema enforcement over human readability.

## 1. Protocol Buffers (Protobuf) & gRPC

**Real-world context:** Internal microservice communication at Google, Uber, Netflix; core of gRPC.

**How it works:** You define a schema (`.proto` file), compile it into language-specific classes (Java, Go, Python, TS), and serialize data to a compact binary stream.

**Strengths:**
*   **Compactness:** Uses Varint encoding (small integers take fewer bytes). Keys are encoded as integer tags (1, 2, 3...) instead of strings (`"user_id"`).
*   **Backward/Forward Compatibility:** You can add new fields or deprecate old ones without breaking existing clients, provided you follow the rules (never reuse a tag number, never change a field's type).

**Engineering Pitfalls:**
*   **Tag Re-use:** If you delete a field (e.g., tag `3`) and later add a new field with tag `3`, old clients will try to parse the new data using the old type, leading to silent corruption. Always mark removed fields as `reserved`.
*   **Default Values:** In Protobuf v3, missing fields and fields set to default values (0, empty string) are indistinguishable on the wire. If you need to know if a field was *explicitly* set, you must use `optional` (introduced in v3.15) or wrapper types (`google.protobuf.StringValue`).

```protobuf
// user.proto
syntax = "proto3";

message User {
  int32 id = 1;
  string name = 2;
  // string email = 3; // Deleted!
  
  reserved 3; // Crucial to prevent reuse
  reserved "email";
  
  optional int32 age = 4; // Distinguishes between explicitly 0 and missing
}
```

## 2. FlatBuffers & Cap'n Proto

**Real-world context:** Game development, high-frequency trading, mobile apps (Facebook Android app).

**How it works:** Unlike Protobuf, which requires an unpacking step to allocate memory and build objects, FlatBuffers and Cap'n Proto lay out the data in memory exactly as it appears on the wire.

**Strengths:**
*   **Zero-Copy Deserialization:** You can mmap a large file or receive a network buffer and instantly start reading data by following pointers. CPU overhead for parsing is essentially zero.
*   **O(1) Access:** You can read a deeply nested field without parsing the rest of the payload.

**Pitfalls:**
*   Larger payload sizes compared to Protobuf (requires padding for alignment).
*   APIs are more cumbersome to use because you build objects bottom-up.

## 3. Self-Describing Binary Formats (MessagePack, CBOR, BSON)

**Real-world context:** Redis (MessagePack), WebAuthn/FIDO2 (CBOR), MongoDB (BSON).

**How it works:** These are essentially "binary JSON". They don't require an external schema (`.proto` file). The types (string, int32, array, map) are encoded inline with the data.

**Strengths:**
*   **Schema-less flexibility:** Great for dynamic data where a strict schema is impossible.
*   **Better Types:** Unlike JSON, they distinguish between ints, floats, byte arrays, and dates natively.
*   **Faster/Smaller than JSON:** Strings don't need escaping, binary data doesn't need Base64 encoding.

**Pitfalls:**
*   Still includes key names in the payload (unlike Protobuf), so payloads are larger than schema-based formats.

## 4. Columnar Formats (Apache Parquet, ORC)

**Real-world context:** Data lakes (S3, GCS), Big Data analytics (Spark, Snowflake, Athena).

**How it works:** Instead of storing data row-by-row, they store it column-by-column.

**Strengths:**
*   **Compression:** All values in a column are of the same type (e.g., all dates, all booleans), allowing for extreme compression (Run-Length Encoding, Dictionary encoding).
*   **Projection Pushdown:** If a query only needs `SELECT age FROM users`, the parser only reads the `age` column from disk, skipping all other columns entirely.

**Engineering Pitfalls:**
*   **Append-Only/Batch:** Extremely expensive to update a single record. These formats are meant to be written once in large batches and read many times.
