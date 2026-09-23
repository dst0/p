import { describe, expect, it } from "vitest";
import {
  computeHostUnavailableMaxAttempts,
  HOST_UNAVAILABLE_MAX_RETRY_DELAY_MS,
  isHostUnavailableError,
  isLocalOrLanBaseUrl,
} from "../src/core/agent-session/constants.ts";

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

describe("isHostUnavailableError", () => {
  const localBaseUrl = "http://192.168.1.50:8080/v1";
  const remoteBaseUrl = "https://api.openai.com/v1";

  it("matches connect-level host-unavailable errors only against a local/LAN base URL", () => {
    const realMessage = "Connection error. (fetch failed -> EHOSTDOWN connect 192.168.1.50:8080)";
    expect(isHostUnavailableError(realMessage, localBaseUrl)).toBe(true);
    expect(isHostUnavailableError(realMessage, remoteBaseUrl)).toBe(false);
  });

  it("matches EHOSTUNREACH, ENETUNREACH, and ECONNREFUSED variants", () => {
    const variants = [
      "Connection error. (fetch failed -> EHOSTUNREACH connect 10.0.0.5:8080)",
      "Connection error. (fetch failed -> ENETUNREACH connect 172.16.0.5:8080)",
      "Connection error. (fetch failed -> ECONNREFUSED connect 127.0.0.1:8080)",
    ];
    for (const message of variants) {
      expect(isHostUnavailableError(message, localBaseUrl), message).toBe(true);
    }
  });

  it("never matches auth, request, or context-overflow errors even against a local host", () => {
    const nonMatching = [
      "401 Unauthorized: invalid api key",
      "400 Bad Request: context length exceeded",
      "rate limit exceeded",
      "Connection error. (fetch failed -> ETIMEDOUT connect 192.168.1.50:8080)",
    ];
    for (const message of nonMatching) {
      expect(isHostUnavailableError(message, localBaseUrl), message).toBe(false);
    }
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
