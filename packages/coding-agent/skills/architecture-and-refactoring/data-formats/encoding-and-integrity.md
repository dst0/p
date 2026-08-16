# Encoding and Integrity

Before data is serialized into documents or packets, the fundamental primitives (characters and bytes) must be encoded. Ensuring the integrity of this data in transit or at rest requires hashing and checksums.

## 1. Character Encodings

**UTF-8:** The absolute standard for text. It uses 1 to 4 bytes per character. ASCII characters take 1 byte. Emojis and complex scripts take 3-4 bytes.
*   **Engineering Rule:** Assume UTF-8 everywhere. Configure databases (e.g., Postgres `utf8mb4`), APIs, and file readers to expect UTF-8.
*   **Pitfall - String Length:** In languages like JavaScript or Java (which use UTF-16 internally), `string.length` returns the number of 16-bit code units, not the number of characters or bytes. The emoji 👨‍👩‍👧‍👦 has a `.length` of 11 in JS, but represents 1 grapheme cluster.

**Latin-1 (ISO-8859-1) / Windows-1252:** Legacy 1-byte encodings. Often encountered when parsing older CSVs or legacy systems. Parsing Latin-1 as UTF-8 will result in replacement characters () or decoding errors.

## 2. Binary-to-Text Encoding

When you need to send binary data (images, cryptographic keys, compiled code) over a medium that only supports text (JSON, HTTP Headers, URLs), you must encode it.

**Base64:**
*   **How it works:** Converts 3 bytes of binary data into 4 ASCII characters. Increases payload size by ~33%.
*   **Pitfall:** Standard Base64 uses `+` and `/`. If placed in a URL, these break routing.
*   **Solution:** Use **Base64URL** encoding (replaces `+` with `-` and `/` with `_`, and strips padding `=`). This is used in JWTs (JSON Web Tokens).

**Hexadecimal (Hex):**
*   Converts 1 byte into 2 hex characters (0-9, a-f). Increases size by 100%. Often used for displaying hashes or cryptographic keys.

## 3. Checksums and Integrity

When transmitting or storing data, you need mathematical guarantees that the data hasn't been corrupted (hardware errors, network glitches) or tampered with.

*   **CRC32 (Cyclic Redundancy Check):** Extremely fast, hardware-accelerated. Used for catching accidental corruption (network noise, disk errors). Used in gzip, Ethernet frames. **Not cryptographically secure.**
*   **SHA-256 (Secure Hash Algorithm):** Slower, but cryptographically secure. Used to ensure data hasn't been maliciously altered. Generates a 32-byte digest.
*   **HMAC (Hash-based Message Authentication Code):** Combines a payload with a secret key and a hash function (like SHA-256). Used for API authentication (e.g., Stripe webhooks, AWS API requests) to prove that the sender holds the secret and the payload is unaltered.

```python
import hmac
import hashlib

def verify_webhook_signature(payload_body: bytes, secret: str, expected_signature: str) -> bool:
    # Compute HMAC-SHA256
    mac = hmac.new(secret.encode('utf-8'), msg=payload_body, digestmod=hashlib.sha256)
    computed_sig = mac.hexdigest()
    
    # Use hmac.compare_digest to prevent timing attacks
    return hmac.compare_digest(computed_sig, expected_signature)
```

## 4. Canonical Serialization

**The Problem:** `{ "a": 1, "b": 2 }` and `{ "b": 2, "a": 1 }` are semantically identical JSON objects. However, their SHA-256 hashes will be completely different because the byte strings differ.

**The Solution:** Canonicalization (Normalization). Before hashing a structured document for digital signatures or caching, it must be serialized in a strictly deterministic way.
*   Keys must be sorted lexicographically.
*   Whitespace must be eliminated.
*   Encoding (UTF-8) must be strictly enforced.

**Real-world context:** AWS SigV4, JWTs, Blockchain transactions. If you do not canonicalize your data before signing, the receiver's hash will mismatch if they serialize it differently.
