import { describe, expect, it } from "vitest";
import {
  detectImageMimeType,
  validateImageUrlForDownload,
  validateIpAddressForDownload,
} from "../src/utils/image-mime.ts";

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
});

describe("detectImageMimeType", () => {
  it("detects standard image formats from magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const gif87 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    const gif89 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

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

  it("returns undefined for unknown/random bytes", () => {
    expect(detectImageMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
    expect(detectImageMimeType(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBeUndefined();
  });
});
