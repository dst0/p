/**
 * Detects image MIME type from binary buffer magic bytes.
 * Returns undefined for empty, truncated, or unrecognized buffers.
 */
export function detectImageMimeType(buffer: Uint8Array | Buffer): string | undefined {
  if (buffer.length < 3) return undefined;
  // JPEG: FF D8 FF (only needs 3 bytes)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length < 4) return undefined;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length >= 8 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
      return "image/png";
    }
    return undefined;
  }
  // GIF: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 && // G
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x38 && // 8
    (buffer[4] === 0x37 || buffer[4] === 0x39) && // 7 or 9
    buffer[5] === 0x61 // a
  ) {
    return "image/gif";
  }
  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return undefined;
}

/**
 * Parse a hostname into a 32-bit IPv4 integer, or null if not IPv4.
 */
export function parseIPv4Strict(hostname: string): number | null {
  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const parts = h.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (part.length === 0 || (part.length > 1 && part[0] === "0") || !/^\d+$/.test(part)) {
      return null;
    }
    const n = parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/**
 * Check if an IPv4 integer falls in a private/reserved/non-global range.
 */
export function isPrivateIPv4(ip: number): { blocked: boolean; reason?: string } {
  const o1 = (ip >>> 24) & 0xff;
  const o2 = (ip >>> 16) & 0xff;
  if (o1 === 127) return { blocked: true, reason: "Loopback IPv4 addresses are not allowed" };
  if (o1 === 10) return { blocked: true, reason: "Private IPv4 addresses (10.0.0.0/8) are not allowed" };
  if (o1 === 172 && o2 >= 16 && o2 <= 31) {
    return { blocked: true, reason: "Private IPv4 addresses (172.16.0.0/12) are not allowed" };
  }
  if (o1 === 192 && o2 === 168) {
    return { blocked: true, reason: "Private IPv4 addresses (192.168.0.0/16) are not allowed" };
  }
  if (o1 === 169 && o2 === 254) {
    return { blocked: true, reason: "Link-local metadata IPv4 addresses (169.254.0.0/16) are not allowed" };
  }
  if (o1 === 100 && o2 >= 64 && o2 <= 127) {
    return { blocked: true, reason: "Carrier-grade NAT addresses (100.64.0.0/10) are not allowed" };
  }
  if (o1 === 0) return { blocked: true, reason: "Non-routable 0.0.0.0 IPv4 address is not allowed" };
  if (o1 >= 224) return { blocked: true, reason: "Multicast or reserved IPv4 addresses are not allowed" };
  return { blocked: false };
}

/**
 * Expand a compressed IPv6 address for prefix matching.
 */
export function expandIPv6(addr: string): string | null {
  let cleaned = addr.startsWith("[") ? addr.slice(1, -1) : addr;
  const v4Mapped = cleaned.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    const ip4 = parseIPv4Strict(v4Mapped[1]);
    if (ip4 !== null) {
      const hi = (ip4 >>> 16) & 0xffff;
      const lo = ip4 & 0xffff;
      cleaned = cleaned.replace(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i, `::ffff:${hi.toString(16)}:${lo.toString(16)}`);
    }
  }

  const sides = cleaned.split("::");
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides.length === 2 ? (sides[1] ? sides[1].split(":") : []) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, "0").toLowerCase()).join(":");
}

/**
 * Validates an IP address (IPv4 or IPv6) against private, loopback, and reserved ranges.
 */
export function validateIpAddressForDownload(ipStr: string): { valid: boolean; reason?: string } {
  const ipv4 = parseIPv4Strict(ipStr);
  if (ipv4 !== null) {
    const check = isPrivateIPv4(ipv4);
    if (check.blocked) return { valid: false, reason: check.reason };
    return { valid: true };
  }

  const expanded = expandIPv6(ipStr);
  if (expanded) {
    if (
      expanded === "0000:0000:0000:0000:0000:0000:0000:0001" ||
      expanded === "0000:0000:0000:0000:0000:0000:0000:0000"
    ) {
      return { valid: false, reason: "Private/loopback IPv6 addresses are not allowed" };
    }
    if (
      expanded.startsWith("fe8") ||
      expanded.startsWith("fe9") ||
      expanded.startsWith("fea") ||
      expanded.startsWith("feb")
    ) {
      return { valid: false, reason: "Link-local IPv6 addresses are not allowed" };
    }
    if (expanded.startsWith("fc") || expanded.startsWith("fd")) {
      return { valid: false, reason: "Unique local IPv6 addresses are not allowed" };
    }
    if (expanded.startsWith("ff")) {
      return { valid: false, reason: "Multicast IPv6 addresses are not allowed" };
    }
    if (expanded.startsWith("0000:0000:0000:0000:0000:ffff:")) {
      const lastTwo = expanded.split(":").slice(6);
      const hi = parseInt(lastTwo[0], 16);
      const lo = parseInt(lastTwo[1], 16);
      const embeddedIP = ((hi << 16) | lo) >>> 0;
      const check = isPrivateIPv4(embeddedIP);
      if (check.blocked) {
        return { valid: false, reason: `IPv4-mapped IPv6 blocked: ${check.reason}` };
      }
    }
    return { valid: true };
  }

  return { valid: false, reason: "Unrecognized IP address format" };
}

/**
 * Validates a download URL against SSRF and private IP address ranges.
 */
export function validateImageUrlForDownload(urlStr: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and standard loopback/local names
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan")
  ) {
    return { valid: false, reason: "Localhost and internal hosts are not allowed for image download" };
  }

  // Check IPv4 addresses (strict dotted-decimal only)
  const ipv4 = parseIPv4Strict(hostname);
  if (ipv4 !== null) {
    const check = isPrivateIPv4(ipv4);
    if (check.blocked) return { valid: false, reason: check.reason };
  }

  // Check IPv6 addresses
  if (hostname.startsWith("[") || hostname.includes(":")) {
    const ipCheck = validateIpAddressForDownload(hostname);
    if (!ipCheck.valid) return ipCheck;
  }

  return { valid: true };
}
