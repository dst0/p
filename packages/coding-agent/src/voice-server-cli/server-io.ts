import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import process from "node:process";
import { getString, isObject, parseArgs, printHelp } from "./cli-setup.ts";
import { MAX_JSON_BYTES } from "./constants.ts";
import type { PromptBody } from "./types.ts";
import { VoiceServer } from "./voiceserver.ts";

export function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    let bytes = 0;

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_JSON_BYTES) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body));
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on("error", reject);
  });
}

export function parsePromptBody(value: unknown): PromptBody {
  if (!isObject(value)) {
    throw new Error("Request body must be a JSON object");
  }
  const message = getString(value.message)?.trim();
  if (!message) {
    throw new Error("Prompt message is required");
  }
  const rawMode = getString(value.mode);
  const mode =
    rawMode === "prompt" || rawMode === "steer" || rawMode === "follow_up" || rawMode === "auto" ? rawMode : "auto";
  return { message, mode };
}

export function writeSse(response: ServerResponse, eventName: string, value: unknown): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

export function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(opener, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === "help") {
    printHelp();
    return;
  }
  await new VoiceServer(options).start();
}
