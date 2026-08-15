/**
 * Extracts a detailed error message from an error, including the cause chain.
 *
 * The OpenAI SDK wraps network errors in `APIConnectionError` with a generic
 * "Connection error." message while stashing the real cause (ECONNREFUSED,
 * ETIMEDOUT, DNS failures, etc.) in `error.cause`. This function walks the
 * cause chain to surface actionable details.
 */
export function extractErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  const status = (error as Error & { status?: unknown }).status;
  const statusCode = typeof status === "number" ? status : undefined;

  let message = error.message;
  if (statusCode !== undefined) {
    message = `API error (${statusCode}): ${message}`;
  }

  // Walk the cause chain to surface the real underlying error
  const causeDetail = extractCauseChain(error);
  if (causeDetail) {
    message = `${message} (${causeDetail})`;
  }

  // Some providers (e.g. via OpenRouter) attach extra info in error.error.metadata.raw
  const rawMetadata = (error as any)?.error?.metadata?.raw;
  if (typeof rawMetadata === "string" && rawMetadata.length > 0) {
    message += `\n${rawMetadata}`;
  }

  return message;
}

/**
 * Walks the `cause` chain of an error and returns a condensed summary.
 * Returns undefined if there is no cause or the cause message duplicates
 * the parent message.
 */
function extractCauseChain(error: Error, maxDepth = 4): string | undefined {
  const parts: string[] = [];
  let current: unknown = error.cause;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (current instanceof Error) {
      const detail = formatCauseError(current);
      if (detail && detail !== error.message && !parts.includes(detail)) {
        parts.push(detail);
      }
      current = current.cause;
    } else if (typeof current === "string") {
      if (current !== error.message && !parts.includes(current)) {
        parts.push(current);
      }
      break;
    } else {
      break;
    }
    depth++;
  }

  return parts.length > 0 ? parts.join(" -> ") : undefined;
}

function formatCauseError(error: Error): string {
  const code = (error as Error & { code?: string }).code;
  const syscall = (error as Error & { syscall?: string }).syscall;
  const address = (error as Error & { address?: string }).address;
  const port = (error as Error & { port?: number }).port;

  // For system errors (ECONNREFUSED, ETIMEDOUT, etc.), build a concise message
  if (code) {
    const parts = [code];
    if (syscall) parts.push(syscall);
    if (address) {
      const addr = port !== undefined ? `${address}:${port}` : address;
      parts.push(addr);
    }
    return parts.join(" ");
  }

  return error.message;
}
