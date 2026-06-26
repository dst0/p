#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type AgentMessage, getFinishWorkPayload } from "@dst0/p-agent-core";
import { VERSION } from "./config.ts";
import { RpcClient } from "./modes/rpc/rpc-client.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_JSON_BYTES = 1024 * 1024;

interface VoiceServerOptions {
	host: string;
	port: number;
	cwd: string;
	open: boolean;
	agentArgs: string[];
}

interface PromptBody {
	message: string;
	mode: "auto" | "prompt" | "steer" | "follow_up";
}

interface SseClient {
	id: number;
	response: ServerResponse;
}

type JsonObject = Record<string, unknown>;

function printHelp(): void {
	process.stdout.write(`p-voice ${VERSION}

Serve a local browser voice interface backed by a persistent P RPC session.

Usage:
  p-voice [options] [-- <p rpc args>]

Options:
  --host <host>   Host to bind. Default: ${DEFAULT_HOST}
  --port <port>   Port to bind. Default: ${DEFAULT_PORT}
  --cwd <path>    Working directory for the P agent. Default: current directory
  --open          Open the page in the default browser after startup
  -h, --help      Show this help

Examples:
  p-voice
  p-voice --open -- --approve --model anthropic/claude-sonnet-4-5
  p-voice --cwd ~/dev/my-project -- --continue
`);
}

function parseArgs(args: string[]): VoiceServerOptions | "help" {
	let host = DEFAULT_HOST;
	let port = DEFAULT_PORT;
	let cwd = process.cwd();
	let open = false;
	let agentArgs: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			agentArgs = args.slice(i + 1);
			break;
		}
		if (arg === "-h" || arg === "--help") {
			return "help";
		}
		if (arg === "--open") {
			open = true;
			continue;
		}
		if (arg === "--host" && args[i + 1]) {
			host = args[++i];
			continue;
		}
		if (arg === "--port" && args[i + 1]) {
			const parsedPort = Number.parseInt(args[++i], 10);
			if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
				throw new Error(`Invalid port: ${args[i]}`);
			}
			port = parsedPort;
			continue;
		}
		if (arg === "--cwd" && args[i + 1]) {
			cwd = resolve(args[++i]);
			continue;
		}
		throw new Error(`Unknown option: ${arg}. Put P RPC arguments after --.`);
	}

	return { host, port, cwd, open, agentArgs };
}

function resolveCliPath(): string {
	if (process.env.P_VOICE_CLI_PATH) {
		return resolve(process.env.P_VOICE_CLI_PATH);
	}
	const currentDir = dirname(fileURLToPath(import.meta.url));
	return join(currentDir, "cli.js");
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function stripSessionStateUpdates(text: string): string {
	return text.replace(/<session_state_update>\s*[\s\S]*?\s*<\/session_state_update>/g, "").trim();
}

function textFromMessage(message: unknown): string {
	if (!isObject(message)) return "";
	const content = message.content;
	if (!Array.isArray(content)) return "";

	let text = "";
	for (const block of content) {
		if (!isObject(block)) continue;
		if (block.type === "text" && typeof block.text === "string") {
			text += block.text;
		}
	}
	return stripSessionStateUpdates(text);
}

function extractFinalText(event: unknown): string | undefined {
	if (!isObject(event) || event.type !== "agent_end" || !Array.isArray(event.messages)) {
		return undefined;
	}

	const messages = event.messages as AgentMessage[];
	const finishPayload = getFinishWorkPayload(messages);
	const finishText = finishPayload?.result ?? finishPayload?.summary;
	if (finishText?.trim()) {
		return finishText.trim();
	}

	for (let i = event.messages.length - 1; i >= 0; i--) {
		const candidate = event.messages[i];
		if (!isObject(candidate) || candidate.role !== "assistant") continue;
		const text = textFromMessage(candidate).trim();
		if (text) return text;
	}
	return undefined;
}

function extractFinalError(event: unknown): string | undefined {
	if (!isObject(event) || event.type !== "agent_end" || !Array.isArray(event.messages)) {
		return undefined;
	}

	for (let i = event.messages.length - 1; i >= 0; i--) {
		const candidate = event.messages[i];
		if (!isObject(candidate) || candidate.role !== "assistant") continue;
		const stopReason = getString(candidate.stopReason);
		const errorMessage = getString(candidate.errorMessage);
		if ((stopReason === "error" || stopReason === "aborted") && errorMessage?.trim()) {
			return errorMessage.trim();
		}
	}
	return undefined;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
	const body = JSON.stringify(value);
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body).toString(),
	});
	response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, contentType: string, body: string): void {
	response.writeHead(statusCode, {
		"content-type": contentType,
		"content-length": Buffer.byteLength(body).toString(),
	});
	response.end(body);
}

function readJson(request: IncomingMessage): Promise<unknown> {
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

function parsePromptBody(value: unknown): PromptBody {
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

function writeSse(response: ServerResponse, eventName: string, value: unknown): void {
	response.write(`event: ${eventName}\n`);
	response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function openBrowser(url: string): void {
	const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(opener, args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

class VoiceServer {
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

const VOICE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>P Voice</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111318;
      --panel: #191d24;
      --panel-2: #202632;
      --text: #f2f5f8;
      --muted: #9aa6b2;
      --border: #343c49;
      --accent: #6ee7b7;
      --accent-2: #93c5fd;
      --danger: #fb7185;
      --warning: #fbbf24;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }

    button,
    textarea,
    select {
      font: inherit;
    }

    .shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: 100vh;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      background: #151922;
    }

    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--warning);
      flex: 0 0 auto;
    }

    .status-dot.ready {
      background: var(--accent);
    }

    .status-dot.error {
      background: var(--danger);
    }

    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      min-height: 0;
    }

    .transcript {
      min-height: 0;
      overflow: auto;
      padding: 18px;
    }

    .empty {
      max-width: 700px;
      margin: 10vh auto 0;
      color: var(--muted);
      line-height: 1.6;
      font-size: 15px;
    }

    .message {
      max-width: 960px;
      margin: 0 auto 12px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.5;
    }

    .message.user {
      border-color: rgba(147, 197, 253, 0.45);
      background: #172235;
    }

    .message.assistant {
      border-color: rgba(110, 231, 183, 0.38);
    }

    .message.tool {
      color: var(--muted);
      font-size: 13px;
      background: #151922;
    }

    .message.error {
      border-color: rgba(251, 113, 133, 0.5);
      color: #fecdd3;
    }

    aside {
      border-left: 1px solid var(--border);
      background: #151922;
      padding: 16px;
      min-height: 0;
      overflow: auto;
    }

    .panel-title {
      margin: 0 0 10px;
      font-size: 13px;
      text-transform: uppercase;
      color: var(--muted);
      letter-spacing: 0;
    }

    .event-list {
      display: grid;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
    }

    .event {
      padding: 9px 10px;
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 7px;
      overflow-wrap: anywhere;
    }

    footer {
      border-top: 1px solid var(--border);
      background: #151922;
      padding: 14px 16px;
    }

    .composer {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    textarea {
      width: 100%;
      min-height: 72px;
      resize: vertical;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 8px;
      padding: 12px;
      line-height: 1.4;
      outline: none;
    }

    textarea:focus {
      border-color: var(--accent-2);
    }

    button,
    select {
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 7px;
      min-height: 38px;
      padding: 8px 10px;
    }

    button {
      cursor: pointer;
    }

    button.primary {
      background: #1f5f4e;
      border-color: #2e8b70;
    }

    button.danger {
      background: #4a1d29;
      border-color: #7f2538;
    }

    button.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
      min-height: 38px;
    }

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }

    @media (max-width: 860px) {
      main {
        grid-template-columns: 1fr;
      }

      aside {
        display: none;
      }

      .composer {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>P Voice</h1>
        <div class="meta">
          <span id="statusDot" class="status-dot"></span>
          <span id="statusText">Connecting...</span>
        </div>
      </div>
      <div class="toolbar">
        <button id="newSessionBtn" title="Start a new P session">New</button>
        <button id="abortBtn" class="danger" title="Abort the current P task">Stop</button>
      </div>
    </header>

    <main>
      <section id="transcript" class="transcript" aria-live="polite">
        <div class="empty" id="emptyState">
          Use the microphone or type a prompt. The browser handles speech recognition and playback; the local server sends the text into P RPC mode so the normal agent loop and tools do the work.
        </div>
      </section>
      <aside>
        <h2 class="panel-title">Activity</h2>
        <div id="events" class="event-list"></div>
      </aside>
    </main>

    <footer>
      <div class="composer">
        <div class="toolbar">
          <button id="micBtn" title="Start or stop speech recognition">Mic</button>
          <button id="speakBtn" class="active" title="Toggle spoken answers">Speak</button>
        </div>
        <textarea id="prompt" placeholder="Speak or type a task for P"></textarea>
        <div class="toolbar">
          <select id="sendMode" title="How to deliver prompts while P is busy">
            <option value="auto">Auto</option>
            <option value="steer">Steer</option>
            <option value="follow_up">Follow-up</option>
            <option value="prompt">Prompt</option>
          </select>
          <button id="sendBtn" class="primary">Send</button>
          <label><input id="autoSend" type="checkbox" checked /> Auto-send speech</label>
        </div>
      </div>
    </footer>
  </div>

  <script>
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const transcript = document.getElementById("transcript");
    const emptyState = document.getElementById("emptyState");
    const events = document.getElementById("events");
    const promptInput = document.getElementById("prompt");
    const sendBtn = document.getElementById("sendBtn");
    const abortBtn = document.getElementById("abortBtn");
    const newSessionBtn = document.getElementById("newSessionBtn");
    const micBtn = document.getElementById("micBtn");
    const speakBtn = document.getElementById("speakBtn");
    const autoSend = document.getElementById("autoSend");
    const sendMode = document.getElementById("sendMode");

    let recognition = null;
    let recognizing = false;
    let speakingEnabled = true;
	    let currentAssistant = null;
	    let currentAssistantText = "";
	    let lastTurnError = "";
	    let retryPending = false;
	    let pendingErrorTimer = null;

    function setStatus(text, state) {
      statusText.textContent = text;
      statusDot.classList.toggle("ready", state === "ready");
      statusDot.classList.toggle("error", state === "error");
    }

    function addMessage(kind, text) {
      emptyState.hidden = true;
      const node = document.createElement("div");
      node.className = "message " + kind;
      node.textContent = text;
      transcript.appendChild(node);
      transcript.scrollTop = transcript.scrollHeight;
      return node;
    }

	    function addEvent(text) {
	      const node = document.createElement("div");
	      node.className = "event";
      node.textContent = text;
      events.prepend(node);
      while (events.children.length > 80) {
        events.lastElementChild.remove();
	      }
	    }

	    function stripSessionStateUpdates(text) {
	      return text.replace(/<session_state_update>\\s*[\\s\\S]*?\\s*<\\/session_state_update>/g, "").trim();
	    }

	    function clearPendingError() {
	      if (!pendingErrorTimer) return;
	      window.clearTimeout(pendingErrorTimer);
	      pendingErrorTimer = null;
	    }

	    function scheduleTerminalError(message) {
	      clearPendingError();
	      pendingErrorTimer = window.setTimeout(() => {
	        pendingErrorTimer = null;
	        addMessage("error", message);
	      }, 400);
	    }

	    function textFromMessage(message) {
	      if (!message || !Array.isArray(message.content)) return "";
	      return stripSessionStateUpdates(message.content
	        .filter((block) => block && block.type === "text" && typeof block.text === "string")
	        .map((block) => block.text)
	        .join(""));
	    }

    function speak(text) {
      if (!speakingEnabled || !text || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }

    function updateAssistant(delta) {
      if (!currentAssistant) {
        currentAssistant = addMessage("assistant", "");
        currentAssistantText = "";
      }
      currentAssistantText += delta;
      currentAssistant.textContent = currentAssistantText;
      transcript.scrollTop = transcript.scrollHeight;
    }

    function handleAgentEvent(event, finalText, finalError) {
      switch (event.type) {
	        case "agent_start":
	          setStatus("P is working", "ready");
	          clearPendingError();
	          currentAssistant = null;
	          currentAssistantText = "";
	          lastTurnError = "";
          retryPending = false;
          addEvent("Agent started");
          break;
        case "message_update":
          if (event.assistantMessageEvent && event.assistantMessageEvent.type === "text_delta") {
            updateAssistant(event.assistantMessageEvent.delta || "");
          }
          break;
        case "message_end": {
          const text = textFromMessage(event.message);
          if (
            event.message &&
            event.message.role === "assistant" &&
            (event.message.stopReason === "error" || event.message.stopReason === "aborted")
          ) {
            lastTurnError = event.message.errorMessage || "P request ended without an assistant response";
          }
          if (event.message && event.message.role === "assistant" && text.trim()) {
            if (!currentAssistant) {
              currentAssistant = addMessage("assistant", text);
            } else if (text.length >= currentAssistantText.length) {
              currentAssistant.textContent = text;
            }
            currentAssistantText = text;
          }
          break;
        }
        case "tool_execution_start":
          addMessage("tool", "Tool: " + event.toolName);
          addEvent("Tool started: " + event.toolName);
          break;
        case "tool_execution_end":
          addEvent("Tool finished: " + event.toolName + (event.isError ? " failed" : ""));
          break;
        case "queue_update":
          addEvent("Queue: " + event.steering.length + " steering, " + event.followUp.length + " follow-up");
          break;
	        case "agent_end":
	          setStatus("Ready", "ready");
	          addEvent("Agent finished");
	          if (finalText && (!currentAssistantText || finalText !== currentAssistantText.trim())) {
	            clearPendingError();
	            addMessage("assistant", finalText);
		          } else if (!event.willRetry && !currentAssistantText.trim() && !retryPending) {
		            scheduleTerminalError(finalError || lastTurnError || "P finished without an assistant response");
		          }
	          if (!finalError && !lastTurnError) {
	            speak(finalText || currentAssistantText);
          }
          currentAssistant = null;
          currentAssistantText = "";
	          break;
	        case "auto_retry_start":
	          clearPendingError();
	          retryPending = true;
	          addEvent("Retrying: " + event.errorMessage);
          break;
	        case "compaction_start":
	          clearPendingError();
	          addEvent("Compaction started");
	          break;
	        case "compaction_end":
	          clearPendingError();
	          addEvent(event.errorMessage ? "Compaction failed" : "Compaction finished");
	          if (event.errorMessage) {
	            addMessage("error", event.errorMessage);
	          }
	          break;
        default:
          break;
      }
    }

    async function postJson(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || response.statusText);
      }
      return json;
    }

    async function sendPrompt() {
      const message = promptInput.value.trim();
      if (!message) return;
      addMessage("user", message);
      promptInput.value = "";
      setStatus("Sending", "ready");
      try {
        await postJson("/api/prompt", { message, mode: sendMode.value });
      } catch (error) {
        setStatus("Error", "error");
        addMessage("error", error.message || String(error));
      }
    }

    function setupSpeechRecognition() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        micBtn.disabled = true;
        micBtn.title = "Speech recognition is not available in this browser";
        return;
      }
      recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.onstart = () => {
        recognizing = true;
        micBtn.classList.add("active");
        setStatus("Listening", "ready");
      };
      recognition.onend = () => {
        recognizing = false;
        micBtn.classList.remove("active");
        setStatus("Ready", "ready");
      };
      recognition.onerror = (event) => {
        setStatus("Mic error", "error");
        addEvent("Speech recognition error: " + event.error);
      };
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript;
          } else {
            interimText += result[0].transcript;
          }
        }
        promptInput.value = (finalText || interimText).trim();
        if (finalText.trim() && autoSend.checked) {
          void sendPrompt();
        }
      };
    }

    sendBtn.addEventListener("click", () => {
      void sendPrompt();
    });
    promptInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void sendPrompt();
      }
    });
    abortBtn.addEventListener("click", async () => {
      try {
        await postJson("/api/abort", {});
        addEvent("Abort requested");
      } catch (error) {
        addMessage("error", error.message || String(error));
      }
    });
    newSessionBtn.addEventListener("click", async () => {
      try {
        await postJson("/api/new-session", {});
        transcript.querySelectorAll(".message").forEach((node) => node.remove());
        emptyState.hidden = false;
        addEvent("New session started");
      } catch (error) {
        addMessage("error", error.message || String(error));
      }
    });
    micBtn.addEventListener("click", () => {
      if (!recognition) return;
      if (recognizing) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });
    speakBtn.addEventListener("click", () => {
      speakingEnabled = !speakingEnabled;
      speakBtn.classList.toggle("active", speakingEnabled);
      if (!speakingEnabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    });

    setupSpeechRecognition();

    const eventsSource = new EventSource("/events");
    eventsSource.addEventListener("status", (message) => {
      const data = JSON.parse(message.data);
      if (data.status === "agent_error") {
        setStatus("Agent error", "error");
        addMessage("error", data.error || "Agent startup failed");
      } else if (data.status === "agent_started") {
        setStatus("Ready", "ready");
      } else {
        setStatus("Idle", "");
      }
    });
    eventsSource.addEventListener("rpc", (message) => {
      const data = JSON.parse(message.data);
      if (data.type === "agent_event") {
        handleAgentEvent(data.event, data.finalText, data.finalError);
      }
    });
    eventsSource.onerror = () => {
      setStatus("Disconnected", "error");
    };

    fetch("/api/state")
      .then((response) => response.json())
      .then(() => setStatus("Ready", "ready"))
      .catch((error) => {
        setStatus("Agent error", "error");
        addMessage("error", error.message || String(error));
      });
  </script>
</body>
</html>
`;

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options === "help") {
		printHelp();
		return;
	}
	await new VoiceServer(options).start();
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
