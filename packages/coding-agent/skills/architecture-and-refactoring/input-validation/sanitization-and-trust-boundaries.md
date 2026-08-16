# Sanitization and Trust Boundaries

Trust boundaries define the perimeter between systems or components where data origin and integrity can no longer be guaranteed. All data crossing a trust boundary must be validated and sanitized.

## Sources of Untrusted Input
Never assume data is safe simply because it's not a direct HTTP request. Untrusted input includes:
- User input (forms, APIs).
- API responses from external third-party services.
- File uploads.
- Environment variables and CLI arguments.
- Data read from a database (if shared with other applications).

## Common Injection Vectors

### SQL Injection (SQLi)
Attacker manipulates SQL queries by injecting malicious payloads.
- **Mitigation**: ALWAYS use parameterized queries or ORMs. Never concatenate strings for SQL.

### Cross-Site Scripting (XSS)
Attacker injects malicious scripts into web pages viewed by other users.
- **Mitigation**: Context-aware output encoding (escaping HTML, JS, CSS attributes). Use frameworks (React, Angular) that auto-escape by default.

### Path Traversal
Attacker uses `../` sequences to access files outside the intended directory.
- **Mitigation**: Validate filenames. Resolve absolute paths and check that they start with the intended base directory.

### Command Injection
Attacker injects shell commands into system calls.
- **Mitigation**: Avoid calling out to the shell (`system()`, `exec()`). If necessary, use APIs that execute commands directly with parameter arrays (e.g., `spawn` without shell), avoiding shell interpolation.

## Allowlisting vs Denylisting

- **Allowlisting (Positive Validation)**: Define exactly what *is* allowed (e.g., `^[a-zA-Z0-9]{3,20}$`). Reject everything else. **This is the secure approach.**
- **Denylisting (Negative Validation)**: Define what *is not* allowed (e.g., block `<script>`). **This is inherently flawed** because attackers constantly invent new bypasses.

## Content-Type Validation
When accepting uploads or payloads:
1. Validate the `Content-Type` header against an allowlist.
2. Validate the actual content payload. Do not rely solely on the file extension or header, as both can be spoofed. (e.g., parsing the magic bytes of an image file).
