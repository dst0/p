import { describe, expect, it } from "vitest";
import {
  classifyHostRetry,
  computeHostUnavailableMaxAttempts,
  describeBaseUrlHost,
  HOST_UNAVAILABLE_MAX_RETRY_DELAY_MS,
  isLocalOrLanBaseUrl,
  isLoopbackBaseUrl,
} from "../src/core/agent-session/host-retry-classification.ts";

describe("isLocalOrLanBaseUrl", () => {
  it("recognizes loopback, RFC1918, link-local, and mDNS hosts", () => {
    const localUrls = [
      "http://localhost:8080/v1",
      "http://127.0.0.1:8080/v1",
      "http://[::1]:8080/v1",
      "http://10.0.0.5:8080/v1",
      "http://172.16.0.5:8080/v1",
      "http://172.31.255.255:8080/v1",
      "http://192.168.1.50:11434/v1",
      "http://169.254.1.5:8080/v1", // IPv4 link-local (APIPA)
      "http://[fe80::1]:8080/v1", // IPv6 link-local
      "http://mini-pc.local:8080/v1", // mDNS
    ];
    for (const url of localUrls) {
      expect(isLocalOrLanBaseUrl(url), `Expected local: ${url}`).toBe(true);
    }
  });

  it("does not treat public hosts or adjacent private ranges as local", () => {
    const remoteUrls = [
      "https://api.openai.com/v1",
      "https://api.anthropic.com",
      "http://8.8.8.8:80/v1",
      "http://172.32.0.1:8080/v1", // just outside 172.16/12
      "http://172.15.255.255:8080/v1", // just outside 172.16/12
      "https://my-remote-server.example.com/v1",
    ];
    for (const url of remoteUrls) {
      expect(isLocalOrLanBaseUrl(url), `Expected not local: ${url}`).toBe(false);
    }
  });

  it("fails closed for missing or malformed baseUrl", () => {
    expect(isLocalOrLanBaseUrl(undefined)).toBe(false);
    expect(isLocalOrLanBaseUrl("")).toBe(false);
    expect(isLocalOrLanBaseUrl("not-a-url")).toBe(false);
  });
});

describe("isLoopbackBaseUrl", () => {
  it("is true only for localhost, 127.0.0.0/8, and ::1", () => {
    for (const url of ["http://localhost:1234/v1", "http://127.0.0.1:8080/v1", "http://[::1]:8080/v1"]) {
      expect(isLoopbackBaseUrl(url), url).toBe(true);
    }
  });

  it("is false for LAN, RFC1918, and remote hosts", () => {
    for (const url of ["http://192.168.1.50:8080/v1", "http://10.0.0.5:8080/v1", "https://api.openai.com/v1"]) {
      expect(isLoopbackBaseUrl(url), url).toBe(false);
    }
  });
});

describe("classifyHostRetry", () => {
  const loopbackBaseUrl = "http://127.0.0.1:1234/v1";
  const lanBaseUrl = "http://192.168.1.50:8080/v1";
  const remoteBaseUrl = "https://api.openai.com/v1";

  it("grants the extended budget for a genuinely unreachable local/LAN host", () => {
    const messages = [
      "Connection error. (fetch failed -> EHOSTDOWN connect 192.168.1.50:8080)",
      "Connection error. (fetch failed -> EHOSTUNREACH connect 10.0.0.5:8080)",
      "Connection error. (fetch failed -> ENETUNREACH connect 172.16.0.5:8080)",
      "Connection error. (fetch failed -> ETIMEDOUT connect 192.168.1.50:8080)",
      "Connection error. (fetch failed -> ECONNRESET read 192.168.1.50:8080)",
      "Connection error. (fetch failed -> socket hang up)",
    ];
    for (const message of messages) {
      expect(classifyHostRetry(message, lanBaseUrl), message).toBe("extended");
    }
  });

  it("grants the extended budget for ECONNREFUSED on a non-loopback LAN host (mid-reboot)", () => {
    const message = "Connection error. (fetch failed -> ECONNREFUSED connect 192.168.1.50:8080)";
    expect(classifyHostRetry(message, lanBaseUrl)).toBe("extended");
  });

  it("classifies ECONNREFUSED on loopback as loopback_refused (server just isn't running)", () => {
    const message = "Connection error. (fetch failed -> ECONNREFUSED connect 127.0.0.1:1234)";
    expect(classifyHostRetry(message, loopbackBaseUrl)).toBe("loopback_refused");
  });

  it("never grants any host-unavailable class against a remote base URL", () => {
    const messages = [
      "Connection error. (fetch failed -> EHOSTDOWN connect 192.168.1.50:8080)",
      "Connection error. (fetch failed -> ECONNREFUSED connect 127.0.0.1:1234)",
      "Connection error. (fetch failed -> ETIMEDOUT connect 192.168.1.50:8080)",
    ];
    for (const message of messages) {
      expect(classifyHostRetry(message, remoteBaseUrl), message).toBe("none");
    }
  });

  it("never matches auth, request, or context-overflow errors even against a local host", () => {
    const nonMatching = [
      "401 Unauthorized: invalid api key",
      "400 Bad Request: context length exceeded",
      "rate limit exceeded",
    ];
    for (const message of nonMatching) {
      expect(classifyHostRetry(message, lanBaseUrl), message).toBe("none");
      expect(classifyHostRetry(message, loopbackBaseUrl), message).toBe("none");
    }
  });
});

describe("describeBaseUrlHost", () => {
  it("returns host:port for a URL with an explicit port", () => {
    expect(describeBaseUrlHost("http://127.0.0.1:1234/v1")).toBe("127.0.0.1:1234");
  });

  it("falls back to the raw baseUrl or a generic label when it cannot parse", () => {
    expect(describeBaseUrlHost("not-a-url")).toBe("not-a-url");
    expect(describeBaseUrlHost(undefined)).toBe("the configured host");
  });
});

describe("computeHostUnavailableMaxAttempts", () => {
  it("grows the attempt budget to cover the full time budget under the default base delay", () => {
    const attempts = computeHostUnavailableMaxAttempts(500, 600_000);
    expect(attempts).toBe(25);
  });

  it("caps per-attempt delay growth so a small budget still yields a small attempt count", () => {
    const attempts = computeHostUnavailableMaxAttempts(500, HOST_UNAVAILABLE_MAX_RETRY_DELAY_MS);
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThan(10);
  });

  it("returns zero attempts for a non-positive budget", () => {
    expect(computeHostUnavailableMaxAttempts(500, 0)).toBe(0);
  });
});
