import { describe, expect, it } from "vitest";
import {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
  extractDiagnosticError,
  formatThrownValue,
} from "../src/utils/diagnostics.ts";

describe("diagnostics utility", () => {
  it("formatThrownValue handles Error, string, and arbitrary values", () => {
    expect(formatThrownValue(new Error("custom error"))).toBe("custom error");
    const errWithoutMsg = new Error();
    errWithoutMsg.name = "CustomErrorName";
    expect(formatThrownValue(errWithoutMsg)).toBe("CustomErrorName");
    expect(formatThrownValue("plain string")).toBe("plain string");
    expect(formatThrownValue(12345)).toBe("12345");
    expect(formatThrownValue(null)).toBe("null");
    expect(formatThrownValue(undefined)).toBe("undefined");
  });

  it("extractDiagnosticError extracts fields for Error and non-Error objects", () => {
    const err = new Error("something went wrong");
    (err as Error & { code?: string }).code = "ERR_FAILED";
    const info1 = extractDiagnosticError(err);
    expect(info1.name).toBe("Error");
    expect(info1.message).toBe("something went wrong");
    expect(info1.code).toBe("ERR_FAILED");
    expect(info1.stack).toBeDefined();

    const numericCodeErr = new Error("number code");
    (numericCodeErr as Error & { code?: number }).code = 404;
    const infoNum = extractDiagnosticError(numericCodeErr);
    expect(infoNum.code).toBe(404);

    const nonErr = extractDiagnosticError("raw error text");
    expect(nonErr.name).toBe("ThrownValue");
    expect(nonErr.message).toBe("raw error text");
    expect(nonErr.code).toBeUndefined();
    expect(nonErr.stack).toBeUndefined();

    const emptyNameMsgErr = new Error("");
    emptyNameMsgErr.name = "";
    const infoEmpty = extractDiagnosticError(emptyNameMsgErr);
    expect(infoEmpty.name).toBeUndefined();
    expect(infoEmpty.message).toBe("");
  });

  it("createAssistantMessageDiagnostic creates a diagnostic object", () => {
    const diag = createAssistantMessageDiagnostic("api_error", new Error("rate limit"), { retries: 3 });
    expect(diag.type).toBe("api_error");
    expect(diag.timestamp).toBeGreaterThan(0);
    expect(diag.error?.message).toBe("rate limit");
    expect(diag.details).toEqual({ retries: 3 });
  });

  it("appendAssistantMessageDiagnostic appends diagnostics to target message", () => {
    const msg: { diagnostics?: ReturnType<typeof createAssistantMessageDiagnostic>[] } = {};
    const diag1 = createAssistantMessageDiagnostic("warn", "first");
    const diag2 = createAssistantMessageDiagnostic("error", "second");

    appendAssistantMessageDiagnostic(msg, diag1);
    expect(msg.diagnostics).toEqual([diag1]);

    appendAssistantMessageDiagnostic(msg, diag2);
    expect(msg.diagnostics).toEqual([diag1, diag2]);
  });
});
