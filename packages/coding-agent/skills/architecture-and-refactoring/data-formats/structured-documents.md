# Structured Documents

Structured document formats represent complex, nested data typically stored in a single file or transmitted in a single payload.

## 1. JSON (JavaScript Object Notation)

**Real-world context:** The undisputed king of Web APIs (REST), browser-server communication, and NoSQL document stores (MongoDB).

**Strengths:** Ubiquitous, natively supported in almost every language, easy to read.

**Engineering Pitfalls:**
*   **Numbers:** JSON does not distinguish between integers and floats. It uses IEEE-754 double-precision floats. Numbers larger than `Number.MAX_SAFE_INTEGER` (2^53 - 1) will lose precision. **Always pass 64-bit integers (e.g., Twitter IDs, Snowflake IDs) as Strings.**
*   **Dates:** JSON has no native Date type. Use ISO 8601 strings (`"2023-10-27T10:00:00Z"`) instead of epoch timestamps to retain timezone context and readability.
*   **Trailing Commas & Comments:** Standard JSON strictly forbids trailing commas and comments. If you need them for config files, use JSONC or JSON5, but standard parsers will fail.
*   **BOM (Byte Order Mark):** Sometimes Windows tools prepend a UTF-8 BOM (`\xEF\xBB\xBF`) to JSON files. Standard `JSON.parse` will throw a syntax error. Strip it before parsing.

## 2. YAML (YAML Ain't Markup Language)

**Real-world context:** Configuration files (Kubernetes, GitHub Actions, Docker Compose, OpenAPI).

**Strengths:** Highly human-readable, minimal punctuation, supports comments, anchors/aliases (DRY configs).

**Engineering Pitfalls:**
*   **The Norway Problem:** In YAML 1.1, unquoted strings like `NO`, `Yes`, `True`, `False`, `On`, `Off` evaluate to booleans. The country code for Norway (`NO`) would parse as `false`. YAML 1.2 fixed this, but many parsers (like PyYAML by default) still use 1.1 rules.
*   **Complex Parsing:** YAML is incredibly complex to parse. It is much slower than JSON.
*   **Security (Arbitrary Code Execution):** YAML allows instantiating custom language objects via tags (`!!python/object/apply:os.system ["echo hacked"]`). **Always use `safe_load()` in Python**, never `load()`.

```python
import yaml

# DANGEROUS - do not use
# data = yaml.load(user_input) 

# SAFE
data = yaml.safe_load(user_input)
```

## 3. TOML (Tom's Obvious, Minimal Language)

**Real-world context:** Package managers (Rust's `Cargo.toml`, Python's `pyproject.toml`), static site generators (Hugo).

**Strengths:** Designed specifically for configuration files. Clear syntax for deep nesting (using `[tables]`), built-in Date/Time types, strings behave predictably. Easier to read than JSON, less ambiguous than YAML.

## 4. XML (eXtensible Markup Language)

**Real-world context:** Enterprise integration (SOAP), configuration (Spring, Maven), document markup (SVG, MathML).

**Strengths:** Schemas (XSD) are incredibly powerful, namespaces prevent collisions, supports mixed content (text with tags inside).

**Engineering Pitfalls:**
*   **XXE (XML External Entity) Attacks:** XML parsers can be configured to resolve external URLs for entity definitions. This allows attackers to read local files or port-scan internal networks. **Always disable entity expansion in XML parsers when parsing untrusted input.**

```python
# Vulnerable to XXE if using standard xml.etree with untrusted input
# Better to use defusedxml
from defusedxml.ElementTree import parse
tree = parse('untrusted_data.xml')
```

## Schema Validation

Schema validation ensures incoming documents conform to your expected types and structure before processing.
*   **JSON:** Use JSON Schema (e.g., `ajv` in Node, `jsonschema` in Python).
*   **TypeScript / Python:** Use runtime validators like `zod` (TS) or `pydantic` (Python) to validate documents at the boundaries and parse them into strongly-typed objects.

```typescript
// Zod example
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  age: z.number().int().min(0).max(120),
  email: z.string().email(),
});

// Throws detailed errors if payload is invalid
const user = UserSchema.parse(jsonPayload); 
```

## File Formatting & Terminal Newlines

When serializing structured documents to disk:
- **Always append a final newline (`\n`):** In both pretty-printed and compact serialization formats (JSON, YAML, TOML), terminating the file with `\n` ensures standard POSIX compliance and clean git diffs (avoiding diff noise on subsequent line additions).
- **Canonical vs Pretty-Printed:** For human-edited configs, format with 2-space indentation and a trailing newline. For cryptographic hashing or hash-chains, use deterministic canonical JSON (sorted keys, no extra whitespace) with explicit newline framing.

