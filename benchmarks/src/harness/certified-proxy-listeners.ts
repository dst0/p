import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export async function openCertifiedProxyLoopbacks(
  handler: (request: IncomingMessage, reply: ServerResponse) => void,
  requestTimeoutMillis: number,
  maxConnections: number,
  listen = listenCertifiedProxyServer,
): Promise<{ port: number; servers: Server[] }> {
  const servers: Server[] = [];
  try {
    const ipv4 = createServer({ headersTimeout: requestTimeoutMillis, requestTimeout: requestTimeoutMillis }, handler);
    ipv4.maxConnections = maxConnections;
    servers.push(ipv4);
    const port = await listen(ipv4, "127.0.0.1", 0);
    const ipv6 = createServer({ headersTimeout: requestTimeoutMillis, requestTimeout: requestTimeoutMillis }, handler);
    ipv6.maxConnections = maxConnections;
    try {
      await listen(ipv6, "::1", port);
      servers.push(ipv6);
    } catch (error) {
      if (!isUnavailableIpv6Loopback(error)) throw error;
    }
    return { port, servers };
  } catch (error) {
    await Promise.allSettled(servers.filter((server) => server.listening).map(closeCertifiedProxyServer));
    throw error;
  }
}

function isUnavailableIpv6Loopback(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT");
}

export async function listenCertifiedProxyServer(server: Server, host: string, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, ipv6Only: host === "::1" }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Certified proxy has no TCP address");
  return address.port;
}

export async function closeCertifiedProxyServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
