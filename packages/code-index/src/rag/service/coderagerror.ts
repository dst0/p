import type { RagErrorCode } from "../types.ts";

export class CodeRagError extends Error {
  readonly code: RagErrorCode;

  constructor(code: RagErrorCode, message: string) {
    super(message);
    this.name = "CodeRagError";
    this.code = code;
  }
}
