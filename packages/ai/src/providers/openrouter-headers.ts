const OPENROUTER_HOSTNAME = "openrouter.ai";

const OPENROUTER_ATTRIBUTION_HEADERS = {
  "HTTP-Referer": "https://github.com/dst0/p",
  "X-OpenRouter-Title": "p",
} as const;

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === OPENROUTER_HOSTNAME || hostname.endsWith(`.${OPENROUTER_HOSTNAME}`);
  } catch {
    return false;
  }
}

function hasHeader(headers: Record<string, string>, expectedName: string): boolean {
  const normalizedName = expectedName.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === normalizedName);
}

export function withOpenRouterAttributionHeaders(
  baseUrl: string,
  ...headerLayers: Array<Record<string, string> | undefined>
): Record<string, string> {
  const isOpenRouter = isOpenRouterBaseUrl(baseUrl);
  const headers: Record<string, string> = {};
  const namesByLowercase = new Map<string, string>();
  for (const layer of headerLayers) {
    if (!layer) continue;
    for (const [name, value] of Object.entries(layer)) {
      if (isOpenRouter) {
        const normalizedName = name.toLowerCase();
        const previousName = namesByLowercase.get(normalizedName);
        if (previousName !== undefined) delete headers[previousName];
        namesByLowercase.set(normalizedName, name);
      }
      Object.defineProperty(headers, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  if (!isOpenRouter) return headers;

  for (const [name, value] of Object.entries(OPENROUTER_ATTRIBUTION_HEADERS)) {
    const hasLegacyTitle = name === "X-OpenRouter-Title" && hasHeader(headers, "X-Title");
    if (!hasHeader(headers, name) && !hasLegacyTitle) headers[name] = value;
  }
  return headers;
}
