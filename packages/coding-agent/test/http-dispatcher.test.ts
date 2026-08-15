import * as undici from "undici";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureHttpDispatcher,
  DEFAULT_HTTP_IDLE_TIMEOUT_MS,
  formatHttpIdleTimeoutMs,
  parseHttpIdleTimeoutMs,
} from "../src/core/http-dispatcher.ts";

describe("http-dispatcher", () => {
  const originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv;
    }
  });

  it("parses timeout values correctly", () => {
    expect(parseHttpIdleTimeoutMs(30_000)).toBe(30_000);
    expect(parseHttpIdleTimeoutMs("60000")).toBe(60_000);
    expect(parseHttpIdleTimeoutMs("disabled")).toBe(0);
    expect(parseHttpIdleTimeoutMs("")).toBeUndefined();
    expect(parseHttpIdleTimeoutMs(-1)).toBeUndefined();
  });

  it("formats timeout values correctly", () => {
    expect(formatHttpIdleTimeoutMs(30_000)).toBe("30 sec");
    expect(formatHttpIdleTimeoutMs(60_000)).toBe("1 min");
    expect(formatHttpIdleTimeoutMs(0)).toBe("disabled");
    expect(formatHttpIdleTimeoutMs(45_000)).toBe("45 sec");
  });

  it("configures global undici dispatcher with default settings", () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    configureHttpDispatcher(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
    const dispatcher = undici.getGlobalDispatcher();
    expect(dispatcher).toBeDefined();
  });

  it("configures dispatcher with rejectUnauthorized: false when NODE_TLS_REJECT_UNAUTHORIZED is 0", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    configureHttpDispatcher(DEFAULT_HTTP_IDLE_TIMEOUT_MS);
    const dispatcher = undici.getGlobalDispatcher();
    expect(dispatcher).toBeDefined();
  });
});
