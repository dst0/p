import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { VERSION } from "../config.ts";
import { RpcClient } from "../modes/rpc/rpc-client.ts";
import { VOICE_PAGE_HTML } from "./constants.ts";
import { extractFinalError, extractFinalText, resolveCliPath, sendJson, sendText } from "./helpers-part1.ts";
import { openBrowser, parsePromptBody, readJson, writeSse } from "./helpers-part2.ts";
import type { SseClient, VoiceServerOptions } from "./types.ts";

export class VoiceServer {
  private readonly options: VoiceServerOptions;
  private readonly client: RpcClient;
  private readonly sseClients = new Map<number, SseClient>();
  private nextSseClientId = 1;
  private startPromise: Promise<void> | undefined;
  private clientStarted = false;
  private lastError: string | undefined;

  constructor(options: VoiceServerOptions) {
    this.options = options;
    this.client = new RpcClient({
      cliPath: resolveCliPath(),
      cwd: options.cwd,
      args: options.agentArgs,
    });
    this.client.onEvent((event) => {
      this.broadcast("rpc", {
        type: "agent_event",
        event,
        finalText: extractFinalText(event),
        finalError: extractFinalError(event),
      });
    });
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });

    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off("error", reject);
        resolvePromise();
      });
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : this.options.port;
    const url = `http://${this.options.host}:${port}/`;
    process.stdout.write(`P voice server listening at ${url}\n`);
    process.stdout.write(`Agent cwd: ${this.options.cwd}\n`);
    if (this.options.agentArgs.length > 0) {
      process.stdout.write(`P RPC args: ${this.options.agentArgs.join(" ")}\n`);
    }
    if (this.options.open) {
      openBrowser(url);
    }

    const shutdown = async () => {
      server.close();
      for (const client of this.sseClients.values()) {
        client.response.end();
      }
      await this.client.stop();
      process.exit(0);
    };
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
  }

  private async ensureClient(): Promise<void> {
    if (this.clientStarted) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.client
      .start()
      .then(() => {
        this.clientStarted = true;
        this.lastError = undefined;
        this.broadcast("status", { type: "status", status: "agent_started" });
      })
      .catch((error: unknown) => {
        this.startPromise = undefined;
        this.lastError = error instanceof Error ? error.message : String(error);
        this.broadcast("status", { type: "status", status: "agent_error", error: this.lastError });
        throw error;
      });

    return this.startPromise;
  }

  private broadcast(eventName: string, value: unknown): void {
    for (const client of this.sseClients.values()) {
      writeSse(client.response, eventName, value);
    }
  }

  private addSseClient(response: ServerResponse): void {
    const id = this.nextSseClientId++;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    writeSse(response, "status", {
      type: "status",
      status: this.clientStarted ? "agent_started" : "idle",
      version: VERSION,
      cwd: this.options.cwd,
      error: this.lastError,
    });
    this.sseClients.set(id, { id, response });
    response.on("close", () => {
      this.sseClients.delete(id);
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (method === "GET" && url.pathname === "/") {
        sendText(response, 200, "text/html; charset=utf-8", VOICE_PAGE_HTML);
        return;
      }

      if (method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
        return;
      }

      if (method === "GET" && url.pathname === "/events") {
        this.addSseClient(response);
        return;
      }

      if (method === "GET" && url.pathname === "/api/info") {
        sendJson(response, 200, {
          version: VERSION,
          cwd: this.options.cwd,
          agentStarted: this.clientStarted,
          error: this.lastError,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/api/state") {
        await this.ensureClient();
        const state = await this.client.getState();
        sendJson(response, 200, { state });
        return;
      }

      if (method === "POST" && url.pathname === "/api/prompt") {
        await this.ensureClient();
        const body = parsePromptBody(await readJson(request));
        const state = await this.client.getState();
        if (body.mode === "steer" || (body.mode === "auto" && state.isStreaming)) {
          await this.client.steer(body.message);
        } else if (body.mode === "follow_up") {
          await this.client.followUp(body.message);
        } else {
          await this.client.prompt(body.message);
        }
        sendJson(response, 202, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/api/abort") {
        await this.ensureClient();
        await this.client.abort();
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/api/new-session") {
        await this.ensureClient();
        const result = await this.client.newSession();
        sendJson(response, 200, { ok: true, result });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      sendJson(response, 500, { error: message });
    }
  }
}
