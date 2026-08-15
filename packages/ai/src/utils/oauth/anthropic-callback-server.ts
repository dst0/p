import type { Server } from "node:http";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";

export type CallbackServerInfo = {
  server: Server;
  redirectUri: string;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string; state: string } | null>;
};

type NodeApis = {
  createServer: typeof import("node:http").createServer;
};

let nodeApis: NodeApis | null = null;
let nodeApisPromise: Promise<NodeApis> | null = null;

export const CALLBACK_HOST = process.env.P_OAUTH_CALLBACK_HOST || "127.0.0.1";
export const CALLBACK_PORT = 53692;
export const CALLBACK_PATH = "/callback";
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

async function getNodeApis(): Promise<NodeApis> {
  if (typeof process === "undefined" || (!process.versions?.node && !process.versions?.bun)) {
    throw new Error("Anthropic OAuth is only available in Node.js environments");
  }
  if (nodeApis) return nodeApis;
  if (!nodeApisPromise) {
    nodeApisPromise = import("node:http").then((httpModule) => ({
      createServer: httpModule.createServer,
    }));
  }
  nodeApis = await nodeApisPromise;
  return nodeApis;
}

export async function startCallbackServer(expectedState: string): Promise<CallbackServerInfo> {
  const { createServer } = await getNodeApis();

  return new Promise((resolve, reject) => {
    let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;
    const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait) => {
      let settled = false;
      settleWait = (value) => {
        if (settled) return;
        settled = true;
        resolveWait(value);
      };
    });

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost");
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("Callback route not found."));
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("Anthropic authentication did not complete.", `Error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("Missing code or state parameter."));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("State mismatch."));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauthSuccessHtml("Anthropic authentication completed. You can close this window."));
        settleWait?.({ code, state });
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error");
      }
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({
        server,
        redirectUri: REDIRECT_URI,
        cancelWait: () => {
          settleWait?.(null);
        },
        waitForCode: () => waitForCodePromise,
      });
    });
  });
}

export async function stopCallbackServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      (server as any).closeAllConnections?.();
    } catch {}
    server.close(() => resolve());
  });
}
