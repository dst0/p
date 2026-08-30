import { describe, expect, it } from "vitest";
import {
  decodeImageBase64Safely,
  detectImageMimeType,
  expandIPv6,
  parseIPv4Strict,
  validateImageUrlForDownload,
  validateIpAddressForDownload,
} from "../src/utils/image-mime.ts";

function pngCrc32(buffer: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= buffer[offset];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("validateImageUrlForDownload", () => {
  it("allows valid public HTTPS/HTTP URLs", () => {
    expect(validateImageUrlForDownload("https://cdn.openai.com/image.png").valid).toBe(true);
    expect(validateImageUrlForDownload("http://example.com/img.jpg").valid).toBe(true);
    expect(validateImageUrlForDownload("https://8.8.8.8/image.png").valid).toBe(true);
  });

  it("blocks basic private IPs and localhost", () => {
    expect(validateImageUrlForDownload("http://localhost:8080/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://127.0.0.1:8080/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://169.254.169.254/latest/meta-data").valid).toBe(false);
    expect(validateImageUrlForDownload("http://10.0.1.5/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://192.168.1.1/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("http://172.20.0.1/image.png").valid).toBe(false);
  });

  it("blocks non-HTTP protocols", () => {
    expect(validateImageUrlForDownload("ftp://example.com/image.png").valid).toBe(false);
    expect(validateImageUrlForDownload("file:///etc/passwd").valid).toBe(false);
    expect(validateImageUrlForDownload("gopher://evil.com/").valid).toBe(false);
  });

  it("blocks integer IP bypass (http://2130706433/ = 127.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://2130706433/");
    expect(r.valid).toBe(false);
  });

  it("blocks octal IP bypass (http://0177.0.0.1/ = 127.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://0177.0.0.1/");
    expect(r.valid).toBe(false);
  });

  it("blocks hex IP bypass (http://0x7f000001/ = 127.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://0x7f000001/");
    expect(r.valid).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 (::ffff:127.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://[::ffff:127.0.0.1]/");
    expect(r.valid).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 for private ranges (::ffff:10.0.0.1)", () => {
    const r = validateImageUrlForDownload("http://[::ffff:10.0.0.1]/");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("IPv4-mapped");
  });

  it("blocks IPv6 loopback and private ranges", () => {
    expect(validateImageUrlForDownload("http://[::1]/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://[fe80::1]/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://[fc00::1]/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://[fd12::1]/").valid).toBe(false);
  });

  it("blocks .localhost, .local, .internal, .lan subdomains", () => {
    expect(validateImageUrlForDownload("http://evil.localhost/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://myhost.local/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://service.internal/").valid).toBe(false);
    expect(validateImageUrlForDownload("http://router.lan/").valid).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(validateImageUrlForDownload("not-a-url").valid).toBe(false);
    expect(validateImageUrlForDownload("").valid).toBe(false);
  });
});

describe("validateIpAddressForDownload", () => {
  it("blocks CGNAT 100.64.0.0/10 addresses", () => {
    expect(validateIpAddressForDownload("100.64.0.1").valid).toBe(false);
    expect(validateIpAddressForDownload("100.100.5.5").valid).toBe(false);
    expect(validateIpAddressForDownload("100.127.255.255").valid).toBe(false);
    expect(validateIpAddressForDownload("100.128.0.1").valid).toBe(true);
  });

  it("blocks multicast and broadcast addresses", () => {
    expect(validateIpAddressForDownload("224.0.0.1").valid).toBe(false);
    expect(validateIpAddressForDownload("255.255.255.255").valid).toBe(false);
  });

  it("blocks non-global IPv6 ranges used for discard, benchmarking, documentation, and ORCHID", () => {
    expect(validateIpAddressForDownload("100::1").valid).toBe(false);
    expect(validateIpAddressForDownload("2001:2::1").valid).toBe(false);
    expect(validateIpAddressForDownload("2001:db8::1").valid).toBe(false);
    expect(validateIpAddressForDownload("2001:20::1").valid).toBe(false);
    expect(validateIpAddressForDownload("2606:4700:4700::1111").valid).toBe(true);
    expect(validateIpAddressForDownload("ff02::1").valid).toBe(false);
    expect(validateIpAddressForDownload("not-an-ip").valid).toBe(false);
    expect(validateIpAddressForDownload("::ffff:8.8.8.8").valid).toBe(true);
  });

  it("blocks reserved, benchmarking, and documentation-only IPv4 ranges", () => {
    expect(validateIpAddressForDownload("192.0.0.1").valid).toBe(false);
    expect(validateIpAddressForDownload("192.0.2.1").valid).toBe(false);
    expect(validateIpAddressForDownload("192.88.99.1").valid).toBe(false);
    expect(validateIpAddressForDownload("198.18.0.1").valid).toBe(false);
    expect(validateIpAddressForDownload("198.19.255.255").valid).toBe(false);
    expect(validateIpAddressForDownload("198.51.100.1").valid).toBe(false);
    expect(validateIpAddressForDownload("203.0.113.1").valid).toBe(false);
    expect(validateIpAddressForDownload("192.0.3.1").valid).toBe(true);
    expect(validateIpAddressForDownload("198.20.0.1").valid).toBe(true);
  });
});

describe("detectImageMimeType", () => {
  it("detects complete standard image envelopes", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08,
      0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
    const gif87 = Buffer.from("R0lGODdhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const gif89 = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

    expect(detectImageMimeType(png)).toBe("image/png");
    expect(detectImageMimeType(jpeg)).toBe("image/jpeg");
    expect(detectImageMimeType(webp)).toBe("image/webp");
    expect(detectImageMimeType(gif87)).toBe("image/gif");
    expect(detectImageMimeType(gif89)).toBe("image/gif");
  });

  it("returns undefined for empty buffer", () => {
    expect(detectImageMimeType(Buffer.alloc(0))).toBeUndefined();
  });

  it("returns undefined for truncated buffers (< minimum header size)", () => {
    expect(detectImageMimeType(Buffer.from([0x89]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0x89, 0x50]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8]))).toBeUndefined();
  });

  it("returns undefined for truncated PNG (4 bytes match but not full 8)", () => {
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    expect(detectImageMimeType(truncatedPng)).toBeUndefined();
  });

  it("rejects signature-only and truncated image envelopes", () => {
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from("GIF89a"))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from("RIFF\0\0\0\0WEBP", "binary"))).toBeUndefined();
  });

  it("rejects image-shaped envelopes without structurally valid payloads", () => {
    const headerOnlyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
    const headerOnlyGif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);
    const zeroPayloadWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x0c, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0x00, 0x00, 0x00,
      0x00,
    ]);
    const corruptPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    corruptPng[corruptPng.length - 1] ^= 0xff;

    expect(detectImageMimeType(headerOnlyJpeg)).toBeUndefined();
    expect(detectImageMimeType(headerOnlyGif)).toBeUndefined();
    expect(detectImageMimeType(zeroPayloadWebp)).toBeUndefined();
    expect(detectImageMimeType(corruptPng)).toBeUndefined();
  });

  it("rejects image envelopes with excessive declared dimensions", () => {
    const oversizedJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0xff, 0xff, 0xff, 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08,
      0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const oversizedPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    oversizedPng.writeUInt32BE(6_001, 16);
    oversizedPng.writeUInt32BE(6_000, 20);
    oversizedPng.writeUInt32BE(pngCrc32(oversizedPng, 12, 29), 29);
    const oversizedGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    oversizedGif.writeUInt16LE(0xffff, 6);
    oversizedGif.writeUInt16LE(0xffff, 8);
    oversizedGif.writeUInt16LE(0xffff, 24);
    oversizedGif.writeUInt16LE(0xffff, 26);
    const oversizedWebp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
    oversizedWebp.writeUInt16LE(0x3fff, 26);
    oversizedWebp.writeUInt16LE(0x3fff, 28);

    expect(detectImageMimeType(oversizedJpeg)).toBeUndefined();
    expect(detectImageMimeType(oversizedPng)).toBeUndefined();
    expect(detectImageMimeType(oversizedGif)).toBeUndefined();
    expect(detectImageMimeType(oversizedWebp)).toBeUndefined();
  });

  it("returns undefined for unknown/random bytes", () => {
    expect(detectImageMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBeUndefined();
  });
});

describe("decodeImageBase64Safely", () => {
  it("accepts the exact decoded-byte boundary and rejects one byte more before decoding", () => {
    expect(decodeImageBase64Safely(Buffer.alloc(5).toString("base64"), 5)).toHaveLength(5);
    expect(() => decodeImageBase64Safely(Buffer.alloc(6).toString("base64"), 5)).toThrow(
      "exceeds maximum limit of 5 bytes",
    );
  });

  it("bounds raw whitespace before normalization", () => {
    expect(() => decodeImageBase64Safely(`${Buffer.alloc(5).toString("base64")} `, 5)).toThrow(
      "exceeds maximum limit of 5 bytes",
    );
  });

  it("treats a negative requested maximum as zero", () => {
    expect(() => decodeImageBase64Safely("AA==", -1)).toThrow("exceeds maximum limit of 0 bytes");
  });

  it("rejects empty, malformed, and impossible base64 shapes", () => {
    for (const encoded of ["", "A", "AA=A", "AA$="]) {
      expect(() => decodeImageBase64Safely(encoded)).toThrow("malformed base64");
    }
  });
});

describe("strict IP parsing", () => {
  it("rejects malformed IPv4 groups and expands public IPv4-mapped IPv6", () => {
    expect(parseIPv4Strict("1..2.3")).toBeNull();
    expect(parseIPv4Strict("1.2.3.999")).toBeNull();
    expect(expandIPv6("::ffff:8.8.8.8")).toBe("0000:0000:0000:0000:0000:ffff:0808:0808");
  });
});
