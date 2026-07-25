import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHttpProxyAgentsForTarget,
  resolveHttpProxyUrlForTarget,
  UNSUPPORTED_PROXY_PROTOCOL_MESSAGE,
} from "../src/utils/node-http-proxy.ts";

describe("node-http-proxy", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.http_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.all_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.no_proxy;
    delete process.env.NO_PROXY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns undefined when no proxy env is set", () => {
    expect(resolveHttpProxyUrlForTarget("https://api.openai.com")).toBeUndefined();
    expect(createHttpProxyAgentsForTarget("https://api.openai.com")).toBeUndefined();
  });

  it("resolves HTTP and HTTPS proxy from environment", () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080";
    const proxyUrl = resolveHttpProxyUrlForTarget("https://api.openai.com");
    expect(proxyUrl?.href).toBe("http://proxy.example.com:8080/");

    const agents = createHttpProxyAgentsForTarget("https://api.openai.com");
    expect(agents).toBeDefined();
    expect(agents?.httpAgent).toBeDefined();
    expect(agents?.httpsAgent).toBeDefined();
  });

  it("handles proxy without protocol prefix by defaulting to target protocol", () => {
    process.env.HTTPS_PROXY = "proxy.example.com:8080";
    const proxyUrl = resolveHttpProxyUrlForTarget("https://api.openai.com");
    expect(proxyUrl?.href).toBe("https://proxy.example.com:8080/");
  });

  it("respects NO_PROXY wildcard and specific domains/ports", () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080";
    process.env.NO_PROXY = "*.openai.com, 127.0.0.1:8000";

    expect(resolveHttpProxyUrlForTarget("https://api.openai.com")).toBeUndefined();
    expect(resolveHttpProxyUrlForTarget("https://other.com")).toBeDefined();
  });

  it("throws error for invalid proxy URL or unsupported protocol", () => {
    process.env.HTTPS_PROXY = "socks5://localhost:1080";
    expect(() => resolveHttpProxyUrlForTarget("https://api.openai.com")).toThrow(UNSUPPORTED_PROXY_PROTOCOL_MESSAGE);

    process.env.HTTPS_PROXY = "http://[invalid-ipv6-host";
    expect(() => resolveHttpProxyUrlForTarget("https://api.openai.com")).toThrow("Invalid proxy URL");
  });

  it("handles invalid target URL gracefully", () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080";
    expect(resolveHttpProxyUrlForTarget("not-a-valid-url")).toBeUndefined();
  });
});
