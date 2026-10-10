import { createHash } from "node:crypto";
import {
  type ClientRequest,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { verifiedCertifiedProxyCa } from "./certified-proxy-ca.ts";
import { closeCertifiedProxyServer, openCertifiedProxyLoopbacks } from "./certified-proxy-listeners.ts";
import { createCertifiedResponseModelCollector } from "./certified-proxy-response-models.ts";

export interface CertifiedEgressProxyOptions {
  upstreamBaseUrl: string;
  expectedModel: string;
  apiKey?: string;
}
export interface CertifiedProxyEvidence {
  requestCount: number;
  requestModels: string[];
  responseModels: string[];
  requestHashes: string[];
}
type ActiveCell = CertifiedProxyEvidence & { label: string; pending: number; rejected: number; completed: number };

const maxRequestBytes = 16 * 1024 * 1024,
  maxBufferedRequestBytes = maxRequestBytes * 2;
const maxConcurrentRequests = 4;
const requestTimeoutMillis = 30_000;
const forwardRequestHeaders = new Set(["accept", "content-type", "user-agent"]);
const hopHeaders = new Set(
  "api-key authorization connection host keep-alive proxy-authenticate proxy-authorization te trailer transfer-encoding upgrade x-api-key".split(
    " ",
  ),
);
export class CertifiedEgressProxy {
  readonly baseUrl: string;
  private readonly upstream: URL;
  private readonly ca?: string[];
  private readonly servers: Server[];
  private readonly apiKey?: string;
  private readonly expectedModel: string;
  private readonly upstreamRequests = new Set<ClientRequest>();
  private readonly upstreamTerminations = new Set<Promise<void>>();
  private readonly inFlight = new Set<Promise<void>>();
  private bufferedRequestBytes = 0;
  private active?: ActiveCell;
  private closed = false;
  constructor(options: CertifiedEgressProxyOptions, port: number, servers: Server[]) {
    this.upstream = new URL(options.upstreamBaseUrl);
    this.baseUrl = `http://${servers.length > 1 ? "localhost" : "127.0.0.1"}:${port}${this.upstream.pathname.replace(/\/$/u, "")}`;
    this.servers = servers;
    this.apiKey = options.apiKey;
    this.expectedModel = options.expectedModel;
    this.ca = this.upstream.protocol === "https:" ? verifiedCertifiedProxyCa() : undefined;
  }
  beginCell(label: string): void {
    if (this.closed || this.active) throw new Error("Certified proxy cell already active or closed");
    this.active = {
      label,
      pending: 0,
      rejected: 0,
      completed: 0,
      requestCount: 0,
      requestModels: [],
      responseModels: [],
      requestHashes: [],
    };
  }
  endCell(label: string): CertifiedProxyEvidence {
    const cell = this.active;
    if (!cell || cell.label !== label) throw new Error("Certified proxy cell identity mismatch");
    this.active = undefined;
    if (cell.pending !== 0 || cell.rejected !== 0 || cell.requestCount === 0) {
      throw new Error("Certified proxy cell rejected requests, has pending requests, or is missing requests");
    }
    if (
      cell.completed !== cell.requestCount ||
      cell.responseModels.length === 0 ||
      cell.responseModels.some((model) => model !== this.expectedModel)
    ) {
      throw new Error("Certified proxy response model evidence is missing or mismatched");
    }
    return {
      requestCount: cell.requestCount,
      requestModels: [...cell.requestModels],
      responseModels: [...cell.responseModels],
      requestHashes: [...cell.requestHashes],
    };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.upstreamRequests) request.destroy(new Error("Certified proxy closed"));
    const results = await Promise.allSettled([
      ...this.servers.map(closeCertifiedProxyServer),
      ...this.inFlight,
      ...this.upstreamTerminations,
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) throw new Error("Certified proxy listener cleanup failed");
  }
  handle(request: IncomingMessage, reply: ServerResponse): void {
    const cell = this.active;
    if (this.inFlight.size >= maxConcurrentRequests) {
      this.reject(reply, cell);
      return;
    }
    const deadline = setTimeout(() => {
      request.destroy();
      reply.destroy();
    }, requestTimeoutMillis);
    const work = this.forward(request, reply)
      .catch(() => {
        request.resume();
        if (cell) cell.rejected += 1;
        if (!reply.headersSent && !reply.destroyed) reply.writeHead(502);
        if (!reply.writableEnded && !reply.destroyed) reply.end();
      })
      .finally(() => {
        clearTimeout(deadline);
        this.inFlight.delete(work);
      });
    this.inFlight.add(work);
  }
  private async forward(request: IncomingMessage, reply: ServerResponse): Promise<void> {
    const cell = this.active;
    if (!cell || this.closed) return this.reject(reply, cell);
    cell.pending += 1;
    let body: Buffer | undefined;
    try {
      const target = request.url;
      const basePath = this.upstream.pathname.replace(/\/$/u, "");
      if (!target?.startsWith(`${basePath}/`) || target.includes("?") || target.includes("#")) {
        return this.reject(reply, cell);
      }
      const suffix = target.slice(basePath.length + 1);
      const completion = request.method === "POST" && suffix === "chat/completions";
      if (!completion && (request.method !== "GET" || suffix !== "models")) return this.reject(reply, cell);
      if (Number(request.headers["content-length"]) > maxRequestBytes) return this.reject(reply, cell);
      body = await this.readBody(request);
      if (!body) return this.reject(reply, cell);
      if (this.active !== cell || this.closed) return this.reject(reply, cell);
      if (completion) {
        let payload: unknown;
        try {
          payload = JSON.parse(body.toString("utf8"));
        } catch {
          return this.reject(reply, cell);
        }
        const model =
          typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).model : undefined;
        if (model !== this.expectedModel) return this.reject(reply, cell);
        cell.requestCount += 1;
        cell.requestModels.push(model);
        cell.requestHashes.push(createHash("sha256").update(body).digest("hex"));
      }
      await this.sendUpstream(target, body, request, reply, cell, completion);
    } finally {
      cell.pending -= 1;
      if (body) this.bufferedRequestBytes -= body.length;
    }
  }
  private reject(reply: ServerResponse, cell: ActiveCell | undefined): void {
    if (cell) cell.rejected += 1;
    reply.req.resume();
    if (!reply.destroyed) reply.writeHead(403).end();
  }
  private async readBody(request: IncomingMessage): Promise<Buffer | undefined> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of request) {
        const next = Buffer.from(chunk);
        if (
          bytes + next.length > maxRequestBytes ||
          this.bufferedRequestBytes + next.length > maxBufferedRequestBytes
        ) {
          throw new Error("Certified proxy request size limit exceeded");
        }
        bytes += next.length;
        this.bufferedRequestBytes += next.length;
        chunks.push(next);
      }
      return Buffer.concat(chunks);
    } catch {
      this.bufferedRequestBytes -= bytes;
      return undefined;
    }
  }
  private async sendUpstream(
    target: string,
    body: Buffer,
    incoming: IncomingMessage,
    outgoing: ServerResponse,
    cell: ActiveCell,
    completion: boolean,
  ): Promise<void> {
    const url = new URL(target, this.upstream);
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined && forwardRequestHeaders.has(key)) headers[key] = value;
    }
    headers["content-length"] = String(body.length);
    if (this.apiKey !== undefined) headers.authorization = `Bearer ${this.apiKey}`;
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    await new Promise<void>((resolve, reject) => {
      const upstreamRequest = requestFn(
        url,
        { method: incoming.method, headers, ...(this.ca ? { ca: this.ca } : {}) },
        (upstreamResponse) => {
          if ((upstreamResponse.statusCode ?? 0) >= 300 && (upstreamResponse.statusCode ?? 0) < 400) {
            upstreamResponse.resume();
            reject(new Error("Certified proxy rejects upstream redirects"));
            return;
          }
          const replyHeaders: Record<string, string | string[]> = {};
          for (const [key, value] of Object.entries(upstreamResponse.headers)) {
            if (value !== undefined && !hopHeaders.has(key)) replyHeaders[key] = value;
          }
          outgoing.writeHead(upstreamResponse.statusCode ?? 502, replyHeaders);
          const collector = createCertifiedResponseModelCollector(upstreamResponse.headers["content-type"]);
          upstreamResponse.on("data", (chunk: Buffer) => {
            outgoing.write(chunk);
            if (!completion) return;
            try {
              collector.push(chunk);
            } catch (error) {
              upstreamRequest.destroy(error as Error);
            }
          });
          upstreamResponse.once("end", () => {
            if (completion && (upstreamResponse.statusCode ?? 0) >= 200 && (upstreamResponse.statusCode ?? 0) < 300) {
              const models = collector.finish();
              if (models.length > 0 && models.every((model) => model === this.expectedModel)) {
                cell.completed += 1;
                cell.responseModels.push(...models);
              }
            }
            outgoing.end();
            resolve();
          });
          upstreamResponse.once("error", reject);
        },
      );
      this.upstreamRequests.add(upstreamRequest);
      let terminated: Promise<void>;
      terminated = new Promise<void>((resolve) => {
        upstreamRequest.once("close", () => {
          this.upstreamRequests.delete(upstreamRequest);
          this.upstreamTerminations.delete(terminated);
          resolve();
        });
      });
      this.upstreamTerminations.add(terminated);
      outgoing.once("close", () => {
        if (!outgoing.writableEnded) upstreamRequest.destroy(new Error("Certified proxy client disconnected"));
      });
      upstreamRequest.once("error", reject);
      upstreamRequest.end(body);
    });
  }
}
export async function startCertifiedEgressProxy(options: CertifiedEgressProxyOptions): Promise<CertifiedEgressProxy> {
  const upstream = new URL(options.upstreamBaseUrl);
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    (upstream.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname)) ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    !options.expectedModel
  ) {
    throw new Error("Invalid certified proxy upstream configuration");
  }
  let proxy: CertifiedEgressProxy | undefined;
  const { port, servers } = await openCertifiedProxyLoopbacks(
    (request, reply) => {
      if (proxy) return proxy.handle(request, reply);
      reply.writeHead(503).end();
    },
    requestTimeoutMillis,
    maxConcurrentRequests * 2,
  );
  proxy = new CertifiedEgressProxy(options, port, servers);
  return proxy;
}
