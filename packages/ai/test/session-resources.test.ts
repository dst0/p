import { describe, expect, it, vi } from "vitest";
import { cleanupSessionResources, registerSessionResourceCleanup } from "../src/session-resources.ts";

describe("session-resources cleanup module", () => {
  it("registers, executes, and unregisters cleanup functions", () => {
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();

    const unregister1 = registerSessionResourceCleanup(cleanup1);
    registerSessionResourceCleanup(cleanup2);

    cleanupSessionResources("sess-1");

    expect(cleanup1).toHaveBeenCalledWith("sess-1");
    expect(cleanup2).toHaveBeenCalledWith("sess-1");

    // Unregister cleanup1
    unregister1();
    cleanup1.mockClear();
    cleanup2.mockClear();

    cleanupSessionResources("sess-2");
    expect(cleanup1).not.toHaveBeenCalled();
    expect(cleanup2).toHaveBeenCalledWith("sess-2");

    // Clean up cleanup2 to avoid state leak
    cleanupSessionResources();
  });

  it("throws AggregateError if one or more cleanups throw errors", () => {
    const error1 = new Error("Cleanup failed 1");
    const error2 = new Error("Cleanup failed 2");

    const unregister1 = registerSessionResourceCleanup(() => {
      throw error1;
    });
    const unregister2 = registerSessionResourceCleanup(() => {
      throw error2;
    });

    expect(() => cleanupSessionResources("error-sess")).toThrow(AggregateError);

    unregister1();
    unregister2();
  });
});
