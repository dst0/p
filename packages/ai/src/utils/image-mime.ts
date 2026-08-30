export { detectImageMimeType } from "./image-envelope.ts";
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/**
 * Decodes provider-controlled base64 without allocating beyond the shared image limit.
 */
export function decodeImageBase64Safely(encoded: string, requestedMaximumBytes = MAX_IMAGE_BYTES): Buffer {
  const maximumBytes = Math.max(0, Math.min(requestedMaximumBytes, MAX_IMAGE_BYTES));
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4;
  if (encoded.length > maximumEncodedLength) {
    throw new Error(`Image data exceeds maximum limit of ${maximumBytes} bytes`);
  }
  const normalized = encoded.replace(/\s/g, "");
  if (normalized.length === 0 || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Provider returned malformed base64 image data");
  }
  const paddingBytes = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const decodedLength = Math.floor((normalized.length * 3) / 4) - paddingBytes;
  if (decodedLength > maximumBytes) {
    throw new Error(`Image data exceeds maximum limit of ${maximumBytes} bytes`);
  }
  return Buffer.from(normalized, "base64");
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
  const o3 = (ip >>> 8) & 0xff;
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
  if (o1 === 192 && o2 === 0 && (o3 === 0 || o3 === 2)) {
    return { blocked: true, reason: "Reserved IPv4 addresses are not allowed" };
  }
  if (o1 === 192 && o2 === 88 && o3 === 99) {
    return { blocked: true, reason: "Reserved IPv4 addresses are not allowed" };
  }
  if (o1 === 198 && (o2 === 18 || o2 === 19)) {
    return { blocked: true, reason: "Benchmarking IPv4 addresses are not allowed" };
  }
  if (o1 === 198 && o2 === 51 && o3 === 100) {
    return { blocked: true, reason: "Documentation-only IPv4 addresses are not allowed" };
  }
  if (o1 === 203 && o2 === 0 && o3 === 113) {
    return { blocked: true, reason: "Documentation-only IPv4 addresses are not allowed" };
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
  if (missing < 0 || (sides.length === 1 && missing !== 0) || (sides.length === 2 && missing === 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
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
    if (
      expanded.startsWith("0100:0000:0000:0000:") ||
      expanded.startsWith("2001:0002:") ||
      expanded.startsWith("2001:0db8:")
    ) {
      return { valid: false, reason: "Non-global IPv6 addresses are not allowed" };
    }
    const secondGroup = parseInt(expanded.slice(5, 9), 16);
    if (expanded.startsWith("2001:") && secondGroup >= 0x20 && secondGroup <= 0x2f) {
      return { valid: false, reason: "Non-global ORCHID IPv6 addresses are not allowed" };
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
