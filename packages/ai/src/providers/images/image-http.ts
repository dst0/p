import { MAX_IMAGE_BYTES } from "../../utils/image-mime.ts";

export const MAX_IMAGE_JSON_RESPONSE_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 4096;
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

export interface ImageJsonRequestOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface ImageJsonResponse<T> {
  data: T;
  response: Response;
}

function requestSignal(signal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  if (signal?.aborted) throw new Error("Request aborted");
  const timeoutSignal = timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined;
  if (signal && timeoutSignal) return AbortSignal.any([signal, timeoutSignal]);
  return signal ?? timeoutSignal;
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function requestedRetryDelayMs(headers: Headers): number | undefined {
  const milliseconds = Number(headers.get("retry-after-ms"));
  if (headers.has("retry-after-ms") && Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function fallbackRetryDelayMs(attempt: number, maximumDelayMs: number): number {
  const fallback = DEFAULT_RETRY_BASE_DELAY_MS * 2 ** attempt;
  return maximumDelayMs > 0 ? Math.min(fallback, maximumDelayMs) : fallback;
}

function retryDelayMs(response: Response, attempt: number, maximumDelayMs: number): number {
  const requested = requestedRetryDelayMs(response.headers);
  if (requested !== undefined) {
    if (maximumDelayMs > 0 && requested > maximumDelayMs) {
      throw new Error(`Provider requested retry delay ${requested}ms exceeds maximum ${maximumDelayMs}ms`);
    }
    return requested;
  }
  return fallbackRetryDelayMs(attempt, maximumDelayMs);
}

function sleepDefault(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Request aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Request aborted"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function readBoundedImageResponse(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
    await response.body?.cancel();
    throw new Error(`Image generation response exceeds maximum limit of ${maximumBytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`Image generation response exceeds maximum limit of ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function responseError(response: Response): Promise<Error> {
  const raw = (await readBoundedImageResponse(response, MAX_ERROR_RESPONSE_BYTES)).slice(0, 500);
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message ?? parsed.message ?? raw;
  } catch {
    // Preserve the bounded text response when the provider does not return JSON.
  }
  return new Error(
    `Image generation request failed: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
  );
}

export async function postImageJson<T>(
  baseUrl: string,
  path: string,
  payload: unknown,
  options: ImageJsonRequestOptions,
): Promise<ImageJsonResponse<T>> {
  const fetchFunction = options.fetch ?? globalThis.fetch;
  if (!fetchFunction) throw new Error("Image generation requires a fetch implementation");
  const url = `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (!headers.has("authorization") && options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
  const maxRetries = options.maxRetries ?? 0;
  if (!Number.isFinite(maxRetries) || !Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("maxRetries must be a non-negative finite integer");
  }
  const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  if (!Number.isFinite(maxRetryDelayMs) || maxRetryDelayMs < 0) {
    throw new Error("maxRetryDelayMs must be a non-negative finite number");
  }

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchFunction(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: requestSignal(options.signal, options.timeoutMs),
      });
    } catch (error) {
      if (options.signal?.aborted) throw new Error("Request aborted");
      if (attempt < maxRetries) {
        const delayMs = fallbackRetryDelayMs(attempt, maxRetryDelayMs);
        await (options.sleep ?? sleepDefault)(delayMs, options.signal);
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      if (attempt < maxRetries && shouldRetry(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        const delayMs = retryDelayMs(response, attempt, maxRetryDelayMs);
        await (options.sleep ?? sleepDefault)(delayMs, options.signal);
        continue;
      }
      throw await responseError(response);
    }
    const responseText = await readBoundedImageResponse(response, MAX_IMAGE_JSON_RESPONSE_BYTES);
    return { data: JSON.parse(responseText) as T, response };
  }
}
