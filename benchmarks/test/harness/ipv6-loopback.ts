import { createServer } from "node:net";

export async function hasIpv6Loopback(): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "::1", port: 0, ipv6Only: true }, resolve);
    });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT"))
      return false;
    throw error;
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
