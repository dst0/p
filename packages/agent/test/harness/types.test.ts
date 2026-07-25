import { describe, expect, it } from "vitest";
import {
  AgentHarnessError,
  BranchSummaryError,
  CompactionError,
  ExecutionError,
  err,
  FileError,
  getOrThrow,
  getOrUndefined,
  ok,
  type Result,
  SessionError,
  toError,
} from "../../src/harness/types.ts";

describe("src/harness/types.ts helper functions and error classes", () => {
  it("ok, err, getOrThrow, and getOrUndefined behave as expected", () => {
    const successResult: Result<object, Error> = ok({ val: 42 });
    const failResult: Result<object, Error> = err(new Error("failed"));

    expect(successResult.ok).toBe(true);
    expect(failResult.ok).toBe(false);

    expect(getOrThrow(successResult)).toEqual({ val: 42 });
    expect(() => getOrThrow(failResult)).toThrow("failed");

    expect(getOrUndefined(successResult)).toEqual({ val: 42 });
    expect(getOrUndefined(failResult)).toBeUndefined();
  });

  it("toError handles Error instances, strings, objects, and circular objects", () => {
    const origErr = new Error("original");
    expect(toError(origErr)).toBe(origErr);

    const strErr = toError("string error");
    expect(strErr.message).toBe("string error");

    const objErr = toError({ code: 123 });
    expect(objErr.message).toBe('{"code":123}');

    // Circular object triggers JSON.stringify catch block (line 36)
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const circErr = toError(circular);
    expect(circErr.message).toContain("[object Object]");
  });

  it("error classes initialize properties and cause correctly", () => {
    const cause = new Error("root cause");

    const fileErr = new FileError("not_found", "File missing", "/tmp/file", cause);
    expect(fileErr.name).toBe("FileError");
    expect(fileErr.code).toBe("not_found");
    expect(fileErr.path).toBe("/tmp/file");
    expect(fileErr.cause).toBe(cause);

    const fileErrNoCause = new FileError("permission_denied", "Access denied");
    expect(fileErrNoCause.cause).toBeUndefined();

    const execErr = new ExecutionError("spawn_error", "Spawn failed", cause);
    expect(execErr.name).toBe("ExecutionError");
    expect(execErr.code).toBe("spawn_error");
    expect(execErr.cause).toBe(cause);

    const compactErr = new CompactionError("aborted", "Compaction aborted", cause);
    expect(compactErr.name).toBe("CompactionError");
    expect(compactErr.code).toBe("aborted");

    const branchErr = new BranchSummaryError("invalid_session", "Invalid session", cause);
    expect(branchErr.name).toBe("BranchSummaryError");
    expect(branchErr.code).toBe("invalid_session");

    const sessionErr = new SessionError("storage", "Storage failure", cause);
    expect(sessionErr.name).toBe("SessionError");
    expect(sessionErr.code).toBe("storage");

    const harnessErr = new AgentHarnessError("busy", "Harness busy", cause);
    expect(harnessErr.name).toBe("AgentHarnessError");
    expect(harnessErr.code).toBe("busy");
  });
});
