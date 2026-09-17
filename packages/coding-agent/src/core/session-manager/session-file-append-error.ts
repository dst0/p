export class SessionFileAppendError extends Error {
  readonly publicationState = "append_unknown" as const;

  constructor(targetPath: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? `: ${cause.message}` : "";
    super(`Session append publication could not be determined: ${targetPath}${causeMessage}`, { cause });
    this.name = "SessionFileAppendError";
  }
}
