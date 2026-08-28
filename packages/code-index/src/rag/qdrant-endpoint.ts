export type QdrantEndpointKind = "managed-local" | "external-local" | "remote";

export interface ResolvedQdrantEndpoint {
  kind: QdrantEndpointKind;
  url: string;
  port?: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function resolveQdrantEndpoint(value: string, remoteBackendsAllowed: boolean): ResolvedQdrantEndpoint {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Code RAG qdrantUrl must be a valid absolute URL (starting with http:// or https://)");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Code RAG qdrantUrl must be a valid absolute URL (starting with http:// or https://)");
  }
  if (url.username || url.password) throw new Error("Code RAG qdrantUrl must not contain credentials");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Code RAG qdrantUrl must identify an origin without a path, query, or fragment");
  }
  if (url.hostname === "0.0.0.0") throw new Error("Code RAG qdrantUrl must not use the wildcard host 0.0.0.0");
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (!isLocal && !remoteBackendsAllowed) {
    throw new Error("Code RAG qdrantUrl must be local unless remoteBackendsAllowed is explicitly enabled");
  }
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    const port = explicitPort(value) ?? 6333;
    return { kind: "managed-local", url: `http://127.0.0.1:${port}`, port };
  }
  return { kind: isLocal ? "external-local" : "remote", url: url.origin };
}

function explicitPort(value: string): number | undefined {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority) return undefined;
  const match = authority.startsWith("[") ? /\]:(\d+)$/.exec(authority) : /:(\d+)$/.exec(authority);
  if (!match) return undefined;
  const port = Number.parseInt(match[1], 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Code RAG qdrantUrl has an invalid port");
  }
  return port;
}
