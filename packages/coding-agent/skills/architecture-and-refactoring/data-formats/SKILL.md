---
name: data-formats
description: Comprehensive reference for data serialization formats - line-delimited streams, structured documents, binary protocols, and encoding/integrity. Use when parsing, generating, or choosing between data formats.
---

# Data Serialization Formats

Choosing the right data serialization format is a critical architectural decision that impacts performance, scalability, interoperability, and long-term maintainability. This skill provides a comprehensive reference on the spectrum of formats available, when to use them, and the engineering pitfalls to avoid.

## Table of Contents

1. [Line-Delimited Formats](./line-delimited-formats.md) - JSONL, CSV, Log formats
2. [Structured Documents](./structured-documents.md) - JSON, YAML, TOML, XML
3. [Binary Formats](./binary-formats.md) - Protobuf, MessagePack, FlatBuffers
4. [Encoding & Integrity](./encoding-and-integrity.md) - UTF-8, Base64, Canonicalization, Hashing

## Format Selection Decision Tree

When selecting a format for a new interface or storage layer, consider the following dimensions:

1. **Human Readability vs. Machine Efficiency**
   - Need human editing (configs)? **TOML, YAML**
   - Need human debugging but mainly machine read/write? **JSON**
   - Pure machine-to-machine, performance critical? **Protobuf, FlatBuffers**

2. **Schema Rigidity vs. Flexibility**
   - Dynamic, schemaless data (e.g., ad-hoc document storage)? **JSON, BSON, MessagePack**
   - Strongly typed, contract-driven (e.g., RPC, event streaming)? **Protobuf, Avro**

3. **Processing Model: Batch vs. Streaming vs. Point-Lookup**
   - Streaming logs/events, append-only? **JSONL, CSV**
   - Loading large datasets into data warehouses? **Parquet, Avro**
   - Extremely fast loading/mmap into memory without parsing? **FlatBuffers, Cap'n Proto**

4. **Interoperability**
   - Web APIs, public-facing REST? **JSON**
   - Internal microservices? **gRPC (Protobuf)**
   - Legacy enterprise systems? **XML**

## General Best Practices

- **Never invent a custom format** unless you are building a domain-specific compression algorithm. Use standardized formats to leverage existing parsers, tooling, and security audits.
- **Design for evolution**. Data models always change. Formats like Protobuf enforce backward/forward compatibility rules. For JSON, you must handle unknown fields gracefully (usually by ignoring them) and treat all new fields as optional.
- **Handle encoding explicitly**. Assume UTF-8 everywhere, but explicitly validate it at the system boundaries.
- **Limit payload sizes**. Always enforce limits on parsing to prevent DoS attacks (e.g., XML entity expansion, deep JSON nesting).
