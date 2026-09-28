import type { Server } from "node:http";

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
