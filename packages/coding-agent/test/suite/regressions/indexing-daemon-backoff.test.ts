import { describe, expect, it } from "vitest";
import { isResourceFailure } from "../../../src/core/indexing-daemon.ts";

describe("resource failure detection", () => {
  describe("isResourceFailure", () => {
    it("detects FilePreparationTaskError with kind resource", () => {
      class ResourceError extends Error {
        readonly kind = "resource";
        constructor(message: string) {
          super(message);
          this.name = "FilePreparationTaskError";
        }
      }
      expect(isResourceFailure(new ResourceError("disk full"))).toBe(true);
    });

    it("detects out of memory in error message", () => {
      expect(isResourceFailure(new Error("out of memory"))).toBe(true);
    });

    it("detects OOM in error message", () => {
      expect(isResourceFailure(new Error("Process terminated: OOM"))).toBe(true);
    });

    it("detects no space left on device", () => {
      expect(isResourceFailure(new Error("no space left on device"))).toBe(true);
    });

    it("detects failed to allocate", () => {
      expect(isResourceFailure(new Error("failed to allocate 4096 bytes"))).toBe(true);
    });

    it("detects EMFILE error", () => {
      expect(isResourceFailure(new Error("EMFILE: too many open files"))).toBe(true);
    });

    it("detects ENOSPC error", () => {
      expect(isResourceFailure(new Error("ENOSPC: write failed"))).toBe(true);
    });

    it("detects ENFILE error", () => {
      expect(isResourceFailure(new Error("ENFILE: system limit"))).toBe(true);
    });

    it("detects Aborted core dumped", () => {
      expect(isResourceFailure(new Error("Aborted (core dumped)"))).toBe(true);
    });

    it("detects process died with SIGABRT", () => {
      expect(isResourceFailure(new Error("process died with exit code 134 and signal SIGABRT"))).toBe(true);
    });

    it("returns false for normal errors", () => {
      expect(isResourceFailure(new Error("connection refused"))).toBe(false);
    });

    it("returns false for syntax errors", () => {
      expect(isResourceFailure(new Error("Unexpected token '}'"))).toBe(false);
    });

    it("returns false for file not found", () => {
      expect(isResourceFailure(new Error("ENOENT: no such file"))).toBe(false);
    });

    it("returns false for timeout errors", () => {
      expect(isResourceFailure(new Error("operation timed out"))).toBe(false);
    });

    it("handles plain string errors", () => {
      expect(isResourceFailure("out of memory")).toBe(true);
      expect(isResourceFailure("something broke")).toBe(false);
    });

    it("handles null and undefined", () => {
      expect(isResourceFailure(null)).toBe(false);
      expect(isResourceFailure(undefined)).toBe(false);
    });

    it("detects OOM mixed in larger message", () => {
      expect(
        isResourceFailure(
          new Error("Indexing failed for /path/to/repo: python process exited: OOM killer terminated the process"),
        ),
      ).toBe(true);
    });
  });
});
