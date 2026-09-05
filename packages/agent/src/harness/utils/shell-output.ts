import {
  type ExecutionEnv,
  type ExecutionEnvExecOptions,
  ExecutionError,
  err,
  ok,
  type Result,
  toError,
} from "../types.ts";
import { DEFAULT_MAX_BYTES, truncateTail } from "./truncate.ts";

export interface ShellCaptureOptions extends Omit<ExecutionEnvExecOptions, "onStdout" | "onStderr"> {
  onChunk?: (chunk: string) => void;
}

export interface ShellCaptureResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

function toExecutionError(error: unknown): ExecutionError {
  if (error instanceof ExecutionError) return error;
  const cause = toError(error);
  return new ExecutionError("unknown", cause.message, cause);
}

// Optimization: Pre-compiled regex to remove control characters except tab, newline, and carriage return
// This avoids expensive array allocations and iterations via Array.from(str).filter(...) in high-frequency streams
const SANITIZE_BINARY_REGEX = /[\x00-\x08\x0b-\x0c\x0e-\x1f\ufff9-\ufffb]/g;

export function sanitizeBinaryOutput(str: string): string {
  return str.replace(SANITIZE_BINARY_REGEX, "");
}

export async function executeShellWithCapture(
  env: ExecutionEnv,
  command: string,
  options?: ShellCaptureOptions,
): Promise<Result<ShellCaptureResult, ExecutionError>> {
  const outputChunks: string[] = [];
  let outputBytes = 0;
  const maxOutputBytes = DEFAULT_MAX_BYTES * 2;
  const encoder = new TextEncoder();

  let totalBytes = 0;
  let fullOutputPath: string | undefined;
  let writeChain: Promise<Result<void, ExecutionError>> = Promise.resolve(ok(undefined));
  let captureError: ExecutionError | undefined;

  const appendFullOutput = (text: string): void => {
    if (!fullOutputPath || captureError) return;
    const path = fullOutputPath;
    writeChain = writeChain.then(async (previous) => {
      if (!previous.ok) return previous;
      const appendResult = await env.appendFile(path, text, options?.abortSignal);
      return appendResult.ok ? ok(undefined) : err(toExecutionError(appendResult.error));
    });
  };

  const ensureFullOutputFile = (initialContent: string): void => {
    if (fullOutputPath || captureError) return;
    writeChain = writeChain.then(async (previous) => {
      if (!previous.ok) return previous;
      const tempFile = await env.createTempFile({
        prefix: "bash-",
        suffix: ".log",
        abortSignal: options?.abortSignal,
      });
      if (!tempFile.ok) return err(toExecutionError(tempFile.error));
      fullOutputPath = tempFile.value;
      const appendResult = await env.appendFile(tempFile.value, initialContent, options?.abortSignal);
      return appendResult.ok ? ok(undefined) : err(toExecutionError(appendResult.error));
    });
  };

  const onChunk = (chunk: string) => {
    try {
      totalBytes += encoder.encode(chunk).byteLength;
      const text = sanitizeBinaryOutput(chunk).replace(/\r/g, "");
      if (totalBytes > DEFAULT_MAX_BYTES && !fullOutputPath) {
        ensureFullOutputFile(outputChunks.join("") + text);
      } else {
        appendFullOutput(text);
      }
      outputChunks.push(text);
      outputBytes += text.length;
      while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
        const removed = outputChunks.shift()!;
        outputBytes -= removed.length;
      }
      options?.onChunk?.(text);
    } catch (error) {
      captureError = toExecutionError(error);
    }
  };

  try {
    const result = await env.exec(command, {
      ...(options ?? {}),
      onStdout: onChunk,
      onStderr: onChunk,
    });
    const tailOutput = outputChunks.join("");
    // Remove trailing newlines to avoid empty lines dominating truncation
    const trimmedOutput = tailOutput.replace(/\n+$/g, "");
    const truncationResult = truncateTail(trimmedOutput);
    if (truncationResult.truncated && !fullOutputPath) {
      ensureFullOutputFile(tailOutput);
    }
    const writeResult = await writeChain;
    if (!writeResult.ok) return err(writeResult.error);
    if (captureError) return err(captureError);

    if (!result.ok) {
      if (result.error.code === "aborted" || options?.abortSignal?.aborted) {
        return ok({
          output: truncationResult.truncated ? truncationResult.content : tailOutput,
          exitCode: undefined,
          cancelled: true,
          truncated: truncationResult.truncated,
          fullOutputPath,
        });
      }
      return err(result.error);
    }
    const cancelled = options?.abortSignal?.aborted ?? false;
    return ok({
      output: truncationResult.truncated ? truncationResult.content : tailOutput,
      exitCode: cancelled ? undefined : result.value.exitCode,
      cancelled,
      truncated: truncationResult.truncated,
      fullOutputPath,
    });
  } catch (error) {
    return err(toExecutionError(error));
  }
}
