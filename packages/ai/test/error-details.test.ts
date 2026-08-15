import { describe, expect, it } from "vitest";
import { extractErrorDetails } from "../src/utils/error-details.ts";

describe("extractErrorDetails", () => {
  it("returns message for plain Error", () => {
    expect(extractErrorDetails(new Error("something broke"))).toBe("something broke");
  });

  it("includes status code when present", () => {
    const err = new Error("rate limited") as Error & { status: number };
    err.status = 429;
    expect(extractErrorDetails(err)).toBe("API error (429): rate limited");
  });

  it("surfaces cause from APIConnectionError-style errors", () => {
    const cause = new Error("connect ECONNREFUSED 192.168.1.100:11450") as Error & {
      code: string;
      syscall: string;
      address: string;
      port: number;
    };
    cause.code = "ECONNREFUSED";
    cause.syscall = "connect";
    cause.address = "192.168.1.100";
    cause.port = 11450;

    const outer = new Error("Connection error.", { cause });
    expect(extractErrorDetails(outer)).toBe("Connection error. (ECONNREFUSED connect 192.168.1.100:11450)");
  });

  it("surfaces ETIMEDOUT cause", () => {
    const cause = new Error("connect ETIMEDOUT 10.0.0.1:443") as Error & {
      code: string;
      syscall: string;
      address: string;
      port: number;
    };
    cause.code = "ETIMEDOUT";
    cause.syscall = "connect";
    cause.address = "10.0.0.1";
    cause.port = 443;

    const outer = new Error("Connection error.", { cause });
    expect(extractErrorDetails(outer)).toBe("Connection error. (ETIMEDOUT connect 10.0.0.1:443)");
  });

  it("surfaces DNS failure cause", () => {
    const cause = new Error("getaddrinfo EAI_AGAIN unknown-host") as Error & {
      code: string;
      syscall: string;
    };
    cause.code = "EAI_AGAIN";
    cause.syscall = "getaddrinfo";

    const outer = new Error("Connection error.", { cause });
    expect(extractErrorDetails(outer)).toBe("Connection error. (EAI_AGAIN getaddrinfo)");
  });

  it("walks nested cause chain", () => {
    const innermost = new Error("socket hang up") as Error & { code: string };
    innermost.code = "ECONNRESET";

    const middle = new Error("fetch failed", { cause: innermost });
    const outer = new Error("Connection error.", { cause: middle });

    expect(extractErrorDetails(outer)).toBe("Connection error. (fetch failed -> ECONNRESET)");
  });

  it("handles string cause", () => {
    const err = new Error("Connection error.", { cause: "ECONNREFUSED 127.0.0.1:8080" });
    expect(extractErrorDetails(err)).toBe("Connection error. (ECONNREFUSED 127.0.0.1:8080)");
  });

  it("skips duplicate cause messages", () => {
    const err = new Error("Connection error.", { cause: new Error("Connection error.") });
    expect(extractErrorDetails(err)).toBe("Connection error.");
  });

  it("respects maxDepth to avoid infinite loops", () => {
    // Create a chain deeper than maxDepth (4)
    let current: Error = new Error("deepest");
    for (let i = 0; i < 10; i++) {
      current = new Error(`level-${i}`, { cause: current });
    }
    const result = extractErrorDetails(current);
    // Should not include all 10 levels
    const parts = result.match(/level-|deepest/g);
    // maxDepth=4 means at most 4 cause parts
    expect(parts!.length).toBeLessThanOrEqual(5); // message + 4 cause parts max
  });

  it("includes rawMetadata when present", () => {
    const err = new Error("API error") as any;
    err.error = { metadata: { raw: "upstream timeout after 30s" } };
    expect(extractErrorDetails(err)).toBe("API error\nupstream timeout after 30s");
  });

  it("handles non-Error values", () => {
    expect(extractErrorDetails("string error")).toBe('"string error"');
    expect(extractErrorDetails(42)).toBe("42");
    expect(extractErrorDetails({ code: "FAIL" })).toBe('{"code":"FAIL"}');
  });

  it("handles non-serializable non-Error values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(extractErrorDetails(circular)).toBe("[object Object]");
  });

  it("combines status + cause", () => {
    const cause = new Error("connect ECONNREFUSED") as Error & { code: string };
    cause.code = "ECONNREFUSED";
    const err = new Error("Connection error.", { cause }) as Error & { status: number };
    err.status = 502;
    expect(extractErrorDetails(err)).toBe("API error (502): Connection error. (ECONNREFUSED)");
  });

  it("handles non-string non-Error causes gracefully", () => {
    const err = new Error("Custom error", { cause: { customData: 123 } });
    expect(extractErrorDetails(err)).toBe("Custom error");
  });
});
