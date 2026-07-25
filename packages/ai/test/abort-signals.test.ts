import { describe, expect, it } from "vitest";
import { combineAbortSignals } from "../src/utils/abort-signals.ts";

describe("abort-signals", () => {
  it("returns no signal when signals array is empty or undefined", () => {
    const res1 = combineAbortSignals([]);
    expect(res1.signal).toBeUndefined();
    expect(typeof res1.cleanup).toBe("function");
    res1.cleanup();

    const res2 = combineAbortSignals([undefined, undefined]);
    expect(res2.signal).toBeUndefined();
    expect(typeof res2.cleanup).toBe("function");
    res2.cleanup();
  });

  it("returns single signal directly when activeSignals length is 1", () => {
    const controller = new AbortController();
    const res = combineAbortSignals([undefined, controller.signal]);
    expect(res.signal).toBe(controller.signal);
    res.cleanup();
  });

  it("aborts combined signal immediately if one signal is already aborted", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    controller1.abort("already aborted");

    const res = combineAbortSignals([controller1.signal, controller2.signal]);
    expect(res.signal).toBeDefined();
    expect(res.signal?.aborted).toBe(true);
    expect(res.signal?.reason).toBe("already aborted");
    res.cleanup();
  });

  it("aborts combined signal when any signal is aborted later", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const res = combineAbortSignals([controller1.signal, controller2.signal]);
    expect(res.signal?.aborted).toBe(false);

    controller2.abort("aborted later");
    expect(res.signal?.aborted).toBe(true);
    expect(res.signal?.reason).toBe("aborted later");

    res.cleanup();
  });
});
