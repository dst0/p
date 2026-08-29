/**
 * Detects image MIME type from binary buffer magic bytes.
 */
export function detectImageMimeType(buffer: Uint8Array | Buffer): string | undefined {
  if (buffer.length < 4) return undefined;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
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
  return undefined;
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
    hostname.endsWith(".internal")
  ) {
    return { valid: false, reason: "Localhost and internal hosts are not allowed for image download" };
  }

  // Check IPv4 addresses
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const octet1 = parseInt(ipv4Match[1], 10);
    const octet2 = parseInt(ipv4Match[2], 10);

    // 127.0.0.0/8 (Loopback)
    if (octet1 === 127) {
      return { valid: false, reason: "Loopback IPv4 addresses are not allowed" };
    }
    // 10.0.0.0/8 (Private)
    if (octet1 === 10) {
      return { valid: false, reason: "Private IPv4 addresses (10.0.0.0/8) are not allowed" };
    }
    // 172.16.0.0/12 (Private)
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) {
      return { valid: false, reason: "Private IPv4 addresses (172.16.0.0/12) are not allowed" };
    }
    // 192.168.0.0/16 (Private)
    if (octet1 === 192 && octet2 === 168) {
      return { valid: false, reason: "Private IPv4 addresses (192.168.0.0/16) are not allowed" };
    }
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (octet1 === 169 && octet2 === 254) {
      return { valid: false, reason: "Link-local metadata IPv4 addresses (169.254.0.0/16) are not allowed" };
    }
    // 0.0.0.0
    if (octet1 === 0) {
      return { valid: false, reason: "Non-routable 0.0.0.0 IPv4 address is not allowed" };
    }
  }

  // Check IPv6 addresses (loopback ::1, link-local fe80::, unique local fc00::)
  if (
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("[fe80:") ||
    hostname.startsWith("fc00:") ||
    hostname.startsWith("[fc00:") ||
    hostname.startsWith("fd")
  ) {
    return { valid: false, reason: "Private/loopback IPv6 addresses are not allowed" };
  }

  return { valid: true };
}
