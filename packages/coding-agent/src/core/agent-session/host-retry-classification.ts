// Codes that mean the destination host itself is unreachable (down, rebooting mid-boot,
// or a dead route) rather than a listening-but-erroring server -- seen as the connect-level
// `code`/message a Node fetch surfaces (see packages/ai error-details.ts and openai
// provider strings), e.g. "Connection error. (fetch failed -> EHOSTDOWN connect
// 192.168.x.x)" or "ETIMEDOUT"/"ECONNRESET"/"socket hang up" while a LAN box reboots.
export const HOST_UNREACHABLE_RETRY_PATTERN = /ehostdown|ehostunreach|enetunreach|etimedout|econnreset|socket hang up/i;

// ECONNREFUSED means something answered "no one is listening on this port". On a
// non-loopback LAN host that's expected mid-reboot (the service isn't up yet), so it gets
// the same extended budget as HOST_UNREACHABLE_RETRY_PATTERN. On loopback it almost always
// means the local model server process just isn't running, which no amount of waiting
// fixes -- see classifyHostRetry below.
export const CONNECTION_REFUSED_RETRY_PATTERN = /econnrefused/i;

export const HOST_UNAVAILABLE_MAX_RETRY_DELAY_MS = 30_000;

function normalizeBaseUrlHost(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return undefined;
  }
}

/** True when `baseUrl` resolves to loopback: localhost, 127.0.0.0/8, or ::1. */
export function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  const host = normalizeBaseUrlHost(baseUrl);
  return host !== undefined && (host === "localhost" || host === "::1" || host.startsWith("127."));
}

/** True when `baseUrl` resolves to loopback, RFC1918, link-local, or a `.local` mDNS host. */
export function isLocalOrLanBaseUrl(baseUrl: string | undefined): boolean {
  const host = normalizeBaseUrlHost(baseUrl);
  if (host === undefined) return false;
  if (isLoopbackBaseUrl(baseUrl) || host.endsWith(".local")) return true;
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
  if (host.startsWith("fe80:")) return true;
  const octets = host.split(".");
  if (octets.length === 4 && octets[0] === "172") {
    const second = Number.parseInt(octets[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Human-readable "host[:port]" for a hint message, falling back to the raw baseUrl. */
export function describeBaseUrlHost(baseUrl: string | undefined): string {
  if (!baseUrl) return "the configured host";
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export type HostRetryClass = "extended" | "loopback_refused" | "none";

/**
 * Classifies a connect-level error against the model's baseUrl:
 * - "extended": a local/LAN host that's genuinely unreachable (or refusing on a non-loopback
 *   LAN host, mid-reboot) -- worth an extended wait.
 * - "loopback_refused": ECONNREFUSED on loopback -- the local server process isn't running;
 *   waiting longer never helps, so callers should keep the normal budget and show a hint.
 * - "none": remote host, or an error unrelated to host reachability.
 */
export function classifyHostRetry(errorMessage: string | undefined, baseUrl: string | undefined): HostRetryClass {
  if (!isLocalOrLanBaseUrl(baseUrl)) return "none";
  const message = errorMessage ?? "";
  if (HOST_UNREACHABLE_RETRY_PATTERN.test(message)) return "extended";
  if (CONNECTION_REFUSED_RETRY_PATTERN.test(message)) {
    return isLoopbackBaseUrl(baseUrl) ? "loopback_refused" : "extended";
  }
  return "none";
}

/**
 * Number of attempts whose exponential backoff (capped at HOST_UNAVAILABLE_MAX_RETRY_DELAY_MS
 * per attempt) sums to at least `budgetMs`. Pure so it can simulate the schedule in tests
 * without waiting real time.
 */
export function computeHostUnavailableMaxAttempts(baseDelayMs: number, budgetMs: number): number {
  const delayBase = baseDelayMs > 0 ? baseDelayMs : 1;
  let elapsed = 0;
  let attempt = 0;
  while (elapsed < budgetMs && attempt < 1000) {
    attempt++;
    elapsed += Math.min(delayBase * 2 ** (attempt - 1), HOST_UNAVAILABLE_MAX_RETRY_DELAY_MS);
  }
  return attempt;
}
