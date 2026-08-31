import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");
const tempDirs: string[] = [];
const servers: Server[] = [];

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) continue;
    server.close();
    await once(server, "close");
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runCli(cwd: string, agentDir: string, args: string[]): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        [ENV_AGENT_DIR]: agentDir,
        P_OFFLINE: "1",
        TSX_TSCONFIG_PATH: resolve(__dirname, "../../../tsconfig.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function writeSseResponse(response: ServerResponse, text: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-session-isolation",
      object: "chat.completion.chunk",
      created: 0,
      model: "session-isolation-faux",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-session-isolation",
      object: "chat.completion.chunk",
      created: 0,
      model: "session-isolation-faux",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

function writeFinishWorkResponse(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-session-isolation-finish",
      object: "chat.completion.chunk",
      created: 0,
      model: "session-isolation-faux",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-session-isolation-finish",
                type: "function",
                function: {
                  name: "finish_work",
                  arguments: JSON.stringify({
                    status: "success",
                    summary: "No work was started in this session. What should I start?",
                  }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

async function startProvider(requestBodies: string[]): Promise<string> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    requestBodies.push(body);
    if (requestBodies.length === 3) {
      writeFinishWorkResponse(response);
      return;
    }
    const responseText = requestBodies.length === 1 ? "Session A recorded." : "No work was started in this session.";
    writeSseResponse(response, responseText);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function writeModelsConfig(agentDir: string, baseUrl: string): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "session-isolation-faux": {
          baseUrl,
          apiKey: "test-key",
          api: "openai-completions",
          models: [
            {
              id: "faux",
              name: "Session Isolation Faux",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              maxTokens: 1024,
            },
          ],
        },
      },
    }),
  );
}

describe("real CLI session isolation", () => {
  it("starts fresh work instead of continuing another session in the same cwd", async () => {
    const projectDir = createTempDir("p-cli-isolation-project-");
    const agentDir = createTempDir("p-cli-isolation-agent-");
    const sessionDir = createTempDir("p-cli-isolation-sessions-");
    const requestBodies: string[] = [];
    writeModelsConfig(agentDir, await startProvider(requestBodies));
    const commonArgs = [
      "--provider",
      "session-isolation-faux",
      "--model",
      "faux",
      "--mode",
      "json",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--approve",
      "--session-dir",
      sessionDir,
      "-p",
    ];

    const sessionA = await runCli(projectDir, agentDir, [
      ...commonArgs,
      "--completion-mode",
      "implicit",
      "--task-verification",
      "off",
      "--no-tools",
      "--session-id",
      "session-a",
      "Continue work on ALPHA_SESSION_SECRET. The unfinished plan is: inspect auth migration, then change production.",
    ]);
    expect(sessionA.code, sessionA.stderr).toBe(0);
    expect(sessionA.stdout).toContain("Session A recorded.");

    const sessionB = await runCli(projectDir, agentDir, [
      ...commonArgs,
      "--completion-mode",
      "explicit",
      "--tools",
      "finish_work",
      "--session-id",
      "session-b",
      "Continue the work. If no earlier work exists in this session, say so and ask what to start.",
    ]);
    expect(sessionB.code, sessionB.stderr).toBe(0);
    expect(sessionB.stdout).toContain("No work was started in this session.");
    expect(sessionB.stdout).toContain('"toolName":"finish_work"');
    expect(sessionB.stdout).toContain('"isError":false');
    expect(sessionB.stdout).toContain('"terminate":true');
    expect(sessionB.stdout).not.toContain("ALPHA_SESSION_SECRET");
    expect(requestBodies).toHaveLength(3);
    expect(requestBodies[1]).not.toContain("ALPHA_SESSION_SECRET");
    expect(requestBodies[1]).not.toContain("inspect auth migration");
    expect(requestBodies[2]).not.toContain("ALPHA_SESSION_SECRET");
    expect(requestBodies[2]).toContain("you did not call `finish_work`");

    const files = readdirSync(sessionDir).filter((file) => file.endsWith(".jsonl"));
    const sessionAFile = files.find((file) => file.includes("_session-a.jsonl"));
    const sessionBFile = files.find((file) => file.includes("_session-b.jsonl"));
    expect(sessionAFile).toBeDefined();
    expect(sessionBFile).toBeDefined();
    expect(sessionAFile).not.toBe(sessionBFile);
    expect(readFileSync(join(sessionDir, sessionAFile!), "utf8")).toContain("ALPHA_SESSION_SECRET");
    expect(readFileSync(join(sessionDir, sessionBFile!), "utf8")).not.toContain("ALPHA_SESSION_SECRET");
  }, 120_000);
});
