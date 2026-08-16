# TypeScript / Node.js Security Best Practices

Node.js and TypeScript ecosystems have specific vulnerability patterns, particularly around asynchronous execution, module ecosystem (npm), and dynamic typing legacy.

## 1. Input Validation & Injection (CWE-74, CWE-89, CWE-94, CWE-22)

### SQL / NoSQL Injection
**Bad Pattern**: String concatenation in queries.
```typescript
// BAD: SQLi (CWE-89)
const user = await db.query(`SELECT * FROM users WHERE username = '${req.body.username}'`);

// BAD: NoSQLi (CWE-943)
const user = await User.find({ username: req.body.username, password: req.body.password });
// Attacker sends: { "username": "admin", "password": { "$ne": null } }
```

**Secure Pattern**: Parameterized queries and strict schema validation.
```typescript
// GOOD: Parameterized (Postgres)
const user = await db.query('SELECT * FROM users WHERE username = $1', [req.body.username]);

// GOOD: Mongoose with strict validation/casting or sanitization
const user = await User.findOne({ 
  username: String(req.body.username), 
  password: String(req.body.password) 
});
```

### Command Injection (CWE-77)
**Bad Pattern**: Using `exec` with user input.
```typescript
const { exec } = require('child_process');
// BAD: Attacker can send "image.jpg; rm -rf /"
exec(`magick convert ${req.query.image} output.png`); 
```

**Secure Pattern**: Use `execFile` or `spawn` with argument arrays.
```typescript
const { execFile } = require('child_process');
// GOOD: Arguments are passed safely
execFile('magick', ['convert', req.query.image, 'output.png']);
```

### Path Traversal (CWE-22)
**Bad Pattern**: Serving files based on unvalidated paths.
```typescript
// BAD: Attacker sends "../../../etc/passwd"
const filePath = path.join(__dirname, 'public', req.query.file);
const content = fs.readFileSync(filePath);
```

**Secure Pattern**: Resolve paths and enforce base directory.
```typescript
const BASE_DIR = path.resolve(__dirname, 'public');
const requestedPath = path.resolve(BASE_DIR, req.query.file);
// GOOD: Ensure resolved path starts with the base directory
if (!requestedPath.startsWith(BASE_DIR)) {
  throw new Error("Invalid path");
}
```

## 2. Authentication & Session Management (CWE-287)

### Password Hashing (CWE-916)
Always use Argon2, scrypt, or bcrypt. Never use MD5 or SHA1/256 for passwords.
```typescript
import * as argon2 from "argon2";
// GOOD
const hash = await argon2.hash("password");
const isMatch = await argon2.verify(hash, "password");
```

### JWT Pitfalls
- Ensure the `alg` header is restricted to strong algorithms (e.g., `HS256`, `RS256`).
- Never allow `none` algorithm.
- Do not store sensitive PII in JWT payloads (they are encoded, not encrypted).
- Use appropriate expiration (`exp`) times.

## 3. Middleware Security

Utilize security headers using libraries like `helmet`.
```typescript
import helmet from 'helmet';
import express from 'express';
const app = express();
app.use(helmet()); // Sets CSP, HSTS, X-Frame-Options, etc.
app.use(express.json({ limit: '10kb' })); // Mitigate DoS via large payloads
```

## 4. Secrets Management (CWE-798)
Never hardcode secrets. Use environment variables.
```typescript
// BAD
const API_KEY = "sk_live_1234567890";

// GOOD
const API_KEY = process.env.STRIPE_SECRET_KEY;
if (!API_KEY) throw new Error("Missing config");
```
Be careful not to log environment variables or configurations that might contain secrets.

## 5. Dependency Supply Chain (CWE-1104)
- Regularly run `npm audit`.
- Use `.npmrc` with `ignore-scripts=true` globally to prevent postinstall malware execution, selectively allowing trusted scripts.
- Pin dependencies in lockfiles (`package-lock.json`, `yarn.lock`).

## 6. Cryptography (CWE-327)
Prefer `crypto.subtle` (Web Crypto API) for standard crypto operations when modern standards are needed, or use robust `node:crypto` features. Use timing-safe comparisons for MACs or passwords.
```typescript
import { timingSafeEqual } from 'node:crypto';
// GOOD: prevents timing attacks on signature verification
const isValid = timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
```
