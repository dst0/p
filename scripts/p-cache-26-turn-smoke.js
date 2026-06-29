#!/usr/bin/env node
import { createServer, request as httpRequest } from "node:http";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const SSH_HOST = process.env.SSH_HOST ?? "dst@192.168.8.167";
const SSH_KEY = process.env.SSH_KEY ?? join(process.env.HOME ?? "", ".ssh/id_ed25519_ssh_mini_pc_760u");
const ORCHESTRATOR_HOST = process.env.ORCHESTRATOR_HOST ?? "192.168.8.167";
const ORCHESTRATOR_PORT = Number(process.env.ORCHESTRATOR_PORT ?? "11450");
const LLAMA_SERVER_HOST = process.env.LLAMA_SERVER_HOST ?? ORCHESTRATOR_HOST;
const LLAMA_SERVER_PORT = Number(process.env.LLAMA_SERVER_PORT ?? "11435");
const LLAMA_SLOT_ID = Number(process.env.LLAMA_SLOT_ID ?? "0");
const LLAMA_LOG_PATH = process.env.LLAMA_LOG_PATH ?? "/opt/llama/logs/llama-server-main-stderr.log";
const MODEL_ID = process.env.MODEL_ID ?? "mini-pc/large-32-kvq4-cache";
const CONTEXT_WINDOW = Number(process.env.CONTEXT_WINDOW ?? "32768");
const SESSION_ID = process.env.SESSION_ID ?? "p-cache-26-turn-smoke";
const TURNS = Number(process.env.TURNS ?? "26");
const MAX_PROMPT_EVAL_POST_FIRST = Number(process.env.MAX_PROMPT_EVAL_POST_FIRST ?? "6000");
const TURN_MAX_TOKENS = Number(process.env.TURN_MAX_TOKENS ?? "1024");
const INTERRUPTION_MAX_TOKENS = Number(process.env.INTERRUPTION_MAX_TOKENS ?? "4096");
const QUEUE_A_MAX_TOKENS = Number(process.env.QUEUE_A_MAX_TOKENS ?? "2048");
const QUEUE_B_MAX_TOKENS = Number(process.env.QUEUE_B_MAX_TOKENS ?? "512");
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? "240000");
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS ?? "10000");
const SSH_TIMEOUT_MS = Number(process.env.SSH_TIMEOUT_MS ?? "15000");
const CLEANUP_SLOT_ON_FAILURE = process.env.CLEANUP_SLOT_ON_FAILURE !== "0";
const ROOT = process.argv[2] ?? join(tmpdir(), `p-cache-26-turn-smoke-${Math.floor(Date.now() / 1000)}`);

const CFG = join(ROOT, "config");
const SESSION_DIR = join(ROOT, "sessions");
const REQUEST_DIR = join(ROOT, "provider-requests");
const PROMPT_CHECK_DIR = join(ROOT, "prompt-checks");
const LOG_DIR = join(ROOT, "logs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDirs() {
	await Promise.all([
		mkdir(join(ROOT, "in"), { recursive: true }),
		mkdir(join(ROOT, "out"), { recursive: true }),
		mkdir(LOG_DIR, { recursive: true }),
		mkdir(SESSION_DIR, { recursive: true }),
		mkdir(CFG, { recursive: true }),
		mkdir(REQUEST_DIR, { recursive: true }),
		mkdir(PROMPT_CHECK_DIR, { recursive: true }),
	]);
}

function runProcess(command, args, options = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let sigtermTimer;
		let sigkillTimer;
		let timeoutTimer;
		const clearTimers = () => {
			if (timeoutTimer) clearTimeout(timeoutTimer);
			if (sigtermTimer) clearTimeout(sigtermTimer);
			if (sigkillTimer) clearTimeout(sigkillTimer);
		};
		if (options.timeoutMs && options.timeoutMs > 0) {
			timeoutTimer = setTimeout(() => {
				timedOut = true;
				stderr += `\nProcess timed out after ${options.timeoutMs}ms`;
				child.kill("SIGINT");
				sigtermTimer = setTimeout(() => child.kill("SIGTERM"), 2000);
				sigkillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
			}, options.timeoutMs);
		}
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
			options.stdoutStream?.write(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
			options.stderrStream?.write(chunk);
		});
		child.on("error", (error) => {
			clearTimers();
			resolve({ code: 1, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
		});
		child.on("close", (code, signal) => {
			clearTimers();
			resolve({ code: timedOut ? 124 : (code ?? 0), signal, stdout, stderr, timedOut });
		});
		if (options.childRef) {
			options.childRef.current = child;
		}
	});
}

async function ssh(command) {
	const result = await runProcess(
		"ssh",
		[
			"-o",
			"ConnectTimeout=8",
			"-o",
			"ServerAliveInterval=5",
			"-o",
			"ServerAliveCountMax=1",
			"-i",
			SSH_KEY,
			SSH_HOST,
			command,
		],
		{ timeoutMs: SSH_TIMEOUT_MS },
	);
	if (result.code !== 0) {
		throw new Error(`ssh failed (${result.code}): ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

async function lineCount() {
	const out = await ssh(`wc -l < '${LLAMA_LOG_PATH}'`);
	return Number(out.trim() || "0");
}

async function fetchLogSince(start, dest) {
	const out = await ssh(`tail -n +${start + 1} '${LLAMA_LOG_PATH}'`);
	await writeFile(dest, out);
}

async function requestCount() {
	try {
		const files = await readdir(REQUEST_DIR);
		return files.filter((file) => file.endsWith(".json")).length;
	} catch {
		return 0;
	}
}

function requestPathForIndex(index) {
	return join(REQUEST_DIR, `${String(index).padStart(6, "0")}.json`);
}

async function compactionEventCount() {
	let files;
	try {
		files = await readdir(SESSION_DIR, { recursive: true });
	} catch {
		return 0;
	}
	let count = 0;
	for (const file of files) {
		if (!String(file).endsWith(".jsonl")) continue;
		const text = await readFile(join(SESSION_DIR, file), "utf8").catch(() => "");
		for (const line of text.split("\n")) {
			if (line.includes('"type":"compaction"') || line.includes('"type": "compaction"')) {
				count++;
			}
		}
	}
	return count;
}

function maxPromptEvalTokens(text) {
	let max = 0;
	for (const line of text.split("\n")) {
		const match = line.match(/prompt eval time =.*\/\s*(\d+)\s+tokens/);
		if (match) {
			max = Math.max(max, Number(match[1]));
		}
	}
	return max;
}

async function writeConfig(proxyPort) {
	await writeFile(
		join(CFG, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					"mini-pc-smoke": {
						baseUrl: `http://127.0.0.1:${proxyPort}/v1`,
						apiKey: "ollama",
						api: "openai-completions",
						models: [
							{
								id: MODEL_ID,
								contextWindow: CONTEXT_WINDOW,
								maxTokens: 4096,
								input: ["text"],
								reasoning: false,
							},
						],
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(CFG, "settings.json"),
		`${JSON.stringify(
			{
				defaultProvider: "mini-pc-smoke",
				defaultModel: MODEL_ID,
				enabledModels: [],
				quietStartup: true,
				enableInstallTelemetry: false,
				completionMode: "explicit",
				compaction: {
					enabled: true,
					reserveTokens: 5000,
				},
			},
			null,
			2,
		)}\n`,
	);
}

async function writeInputs() {
	for (let turn = 1; turn <= TURNS; turn++) {
		const n = String(turn).padStart(2, "0");
		const input = `turn ${n} source line one\nsymbols-${n}: alpha beta gamma, punctuation stays.\nmixedCase-${n}: CacheReuseMustStayStable\n`;
		await writeFile(join(ROOT, "in", `file-${n}.txt`), input);
		await writeFile(join(ROOT, "out", `file-${n}.expected`), input.toUpperCase());
	}
}

function normalizeText(text) {
	return text.replace(/\n?$/u, "\n");
}

function startProxy() {
	let counter = 0;
	const activeUpstreams = new Set();
	const server = createServer((clientReq, clientRes) => {
		if (clientReq.method !== "POST") {
			clientRes.writeHead(404, { Connection: "close" });
			clientRes.end();
			return;
		}

		const chunks = [];
		clientReq.on("data", (chunk) => chunks.push(chunk));
		clientReq.on("end", async () => {
			const body = Buffer.concat(chunks);
			counter++;
			const index = counter;
			await writeFile(
				join(REQUEST_DIR, `${String(index).padStart(6, "0")}.json`),
				`${JSON.stringify({
					index,
					method: "POST",
					path: clientReq.url,
					body: body.toString("utf8"),
				})}\n`,
			);

			const headers = { ...clientReq.headers, host: `${ORCHESTRATOR_HOST}:${ORCHESTRATOR_PORT}` };
			delete headers.connection;
			delete headers["content-length"];
			const upstream = httpRequest(
				{
					host: ORCHESTRATOR_HOST,
					port: ORCHESTRATOR_PORT,
					path: clientReq.url,
					method: "POST",
					headers: {
						...headers,
						"content-length": body.length,
					},
				},
				(upstreamRes) => {
					const responseHeaders = {};
					for (const [key, value] of Object.entries(upstreamRes.headers)) {
						if (
							[
								"connection",
								"keep-alive",
								"proxy-authenticate",
								"proxy-authorization",
								"te",
								"trailers",
								"transfer-encoding",
								"upgrade",
							].includes(key.toLowerCase())
						) {
							continue;
						}
						responseHeaders[key] = value;
					}
					responseHeaders.connection = "close";
					clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, responseHeaders);
					upstreamRes.on("data", (chunk) => {
						if (!clientRes.destroyed) {
							clientRes.write(chunk);
						}
					});
					upstreamRes.on("end", () => {
						if (!clientRes.destroyed) {
							clientRes.end();
						}
						activeUpstreams.delete(upstream);
					});
				},
			);
			activeUpstreams.add(upstream);
			clientRes.on("close", () => {
				if (!upstream.destroyed) {
					upstream.destroy();
				}
			});
			upstream.on("error", () => {
				activeUpstreams.delete(upstream);
				if (!clientRes.headersSent) {
					clientRes.writeHead(502, { Connection: "close" });
				}
				if (!clientRes.destroyed) {
					clientRes.end();
				}
			});
			upstream.end(body);
		});
	});

	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve({
				port: typeof address === "object" && address ? address.port : 0,
				close: async () => {
					for (const upstream of activeUpstreams) {
						upstream.destroy();
					}
					await new Promise((done) => server.close(done));
				},
			});
		});
	});
}

function requestMessages(path) {
	return readFile(path, "utf8").then((raw) => {
		const capture = JSON.parse(raw);
		const body = JSON.parse(capture.body);
		const messages = body.messages ?? body.input;
		if (!Array.isArray(messages)) {
			throw new Error(`request ${path} has no message list`);
		}
		return messages;
	});
}

function normalized(messages) {
	return messages.map((message) => {
		if (!message || typeof message !== "object" || Array.isArray(message)) {
			return message;
		}
		const result = {};
		for (const key of ["role", "content", "name", "tool_call_id", "tool_calls"]) {
			if (key in message) {
				result[key] = message[key];
			}
		}
		return result;
	});
}

function firstMismatch(expected, actual) {
	const limit = Math.min(expected.length, actual.length);
	for (let index = 0; index < limit; index++) {
		if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) {
			return index;
		}
	}
	return expected.length > actual.length ? limit : null;
}

function anchorWindow(messages, fraction) {
	if (messages.length <= 8) return messages;
	const width = Math.min(6, Math.max(2, Math.floor(messages.length / 8)));
	const start = Math.min(Math.max(0, Math.floor(messages.length * fraction) - Math.floor(width / 2)), messages.length - width);
	return messages.slice(start, start + width);
}

function containsWindow(messages, window) {
	if (window.length === 0) return true;
	const serialized = window.map((message) => JSON.stringify(message));
	for (let index = 0; index <= messages.length - window.length; index++) {
		const candidate = messages.slice(index, index + window.length).map((message) => JSON.stringify(message));
		if (candidate.every((message, offset) => message === serialized[offset])) {
			return true;
		}
	}
	return false;
}

async function verifyPromptStability(turn, reqBefore, reqAfter, compactionBefore, compactionAfter) {
	const compacted = compactionAfter > compactionBefore;
	const label = String(turn).padStart(2, "0");
	let postCompactionBaselineReset = false;
	if (compacted) {
		console.log(`turn ${label} compaction detected; prompt-stability and prompt-eval baselines reset`);
	}
	if (reqAfter <= reqBefore) {
		throw Object.assign(new Error(`turn ${label} emitted no provider requests`), { code: 96 });
	}

	const checkpointPath = join(PROMPT_CHECK_DIR, "last-prompt.json");
	const firstRequestPath = requestPathForIndex(reqBefore + 1);
	const lastRequestPath = requestPathForIndex(reqAfter);
	const currentFirst = normalized(await requestMessages(firstRequestPath));
	const currentLast = normalized(await requestMessages(lastRequestPath));

	if (!compacted) {
		const exists = await stat(checkpointPath).then(() => true, () => false);
		if (exists) {
			const previous = JSON.parse(await readFile(checkpointPath, "utf8"));
			postCompactionBaselineReset = previous.compacted === true;
			if (postCompactionBaselineReset) {
				console.log(`turn ${label} post-compaction first request; prompt-stability baseline reset`);
			} else {
				const mismatch = firstMismatch(previous.messages, currentFirst);
				if (mismatch !== null) {
					const startAnchor = previous.messages.slice(0, Math.min(8, previous.messages.length));
					const middleAnchor = anchorWindow(previous.messages, 0.5);
					const startAnchorOk = JSON.stringify(currentFirst.slice(0, startAnchor.length)) === JSON.stringify(startAnchor);
					const middleAnchorOk = containsWindow(currentFirst, middleAnchor);
					const diagnosticPath = join(PROMPT_CHECK_DIR, `last-prompt.turn-${label}.mismatch.json`);
					await writeFile(
						diagnosticPath,
						`${JSON.stringify(
							{
								turn: label,
								previous_request: previous.request,
								current_first_request: firstRequestPath,
								mismatch_index: mismatch,
								previous_len: previous.messages.length,
								current_first_len: currentFirst.length,
								start_anchor_ok: startAnchorOk,
								middle_anchor_ok: middleAnchorOk,
								previous_at_mismatch: previous.messages.slice(mismatch, mismatch + 3),
								current_at_mismatch: currentFirst.slice(mismatch, mismatch + 3),
							},
							null,
							2,
						)}\n`,
					);
					if (!startAnchorOk || !middleAnchorOk) {
						throw Object.assign(
							new Error(
								`turn ${label}: provider-visible prompt lost stable anchors before compaction; mismatch at message ${mismatch}; diagnostic=${diagnosticPath}`,
							),
							{ code: 97 },
						);
					}
					console.log(
						`turn ${label}: provider-visible prompt exact match shifted but stable anchors remain; diagnostic=${diagnosticPath}`,
					);
				}
			}
		}
	}

	await writeFile(
		checkpointPath,
		`${JSON.stringify({
			turn: label,
			request: lastRequestPath,
			compacted,
			messages: currentLast,
		})}\n`,
	);
	return { compacted, postCompactionBaselineReset };
}

function startP(args, stdoutPath, stderrPath) {
	const stdoutStream = createWriteStream(stdoutPath);
	const stderrStream = createWriteStream(stderrPath);
	const childRef = { current: null };
	const promise = runProcess("p", args, {
		cwd: ROOT,
		env: {
			...process.env,
			P_CODING_AGENT_DIR: CFG,
		},
		stdoutStream,
		stderrStream,
		childRef,
		timeoutMs: TURN_TIMEOUT_MS,
	}).finally(() => {
		stdoutStream.end();
		stderrStream.end();
	});
	return { child: childRef, promise };
}

function basePArgs(maxTokens, prompt, sessionId = SESSION_ID) {
	return [
		"--provider",
		"mini-pc-smoke",
		"--model",
		MODEL_ID,
		"--session-dir",
		SESSION_DIR,
		"--session-id",
		sessionId,
		"--approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--max-tokens",
		String(maxTokens),
		"-p",
		prompt,
	];
}

async function runTurn(turn) {
	const n = String(turn).padStart(2, "0");
	const before = await lineCount();
	const reqBefore = await requestCount();
	const compactionBefore = await compactionEventCount();
	const stdoutPath = join(LOG_DIR, `turn-${n}.out`);
	const stderrPath = join(LOG_DIR, `turn-${n}.err`);
	const afterLog = join(LOG_DIR, `turn-${n}.llama.log`);

	console.log(`turn ${n} start`);
	const prompt = `Turn ${n} of ${TURNS}. Use the read tool to read in/file-${n}.txt. Convert every alphabetic letter in that file to uppercase while preserving digits, punctuation, spaces, and newlines. Use the write tool to write exactly the transformed text to out/file-${n}.txt. Do not use bash for this turn. Then call finish_work.`;
	const { promise } = startP(basePArgs(TURN_MAX_TOKENS, prompt), stdoutPath, stderrPath);
	const result = await promise;
	await fetchLogSince(before, afterLog);

	if (result.code !== 0) {
		const stderr = await readFile(stderrPath, "utf8").catch(() => "");
		console.error(`turn ${n} failed with exit ${result.code}`);
		console.error(stderr.split("\n").slice(-80).join("\n"));
		throw Object.assign(new Error(result.timedOut ? `turn ${n} timed out` : `turn ${n} failed`), {
			code: result.code || 1,
		});
	}

	const reqAfter = await requestCount();
	const compactionAfter = await compactionEventCount();
	const promptStability = await verifyPromptStability(turn, reqBefore, reqAfter, compactionBefore, compactionAfter);
	const compactionBaselineReset = promptStability.compacted || promptStability.postCompactionBaselineReset;

	const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
	const stderr = await readFile(stderrPath, "utf8").catch(() => "");
	if (`${stdout}\n${stderr}`.includes("cannot continue from message role: assistant")) {
		throw Object.assign(new Error(`turn ${n} hit cannot-continue assistant-role regression`), { code: 91 });
	}

	const expected = normalizeText(await readFile(join(ROOT, "out", `file-${n}.expected`), "utf8"));
	const actual = normalizeText(await readFile(join(ROOT, "out", `file-${n}.txt`), "utf8"));
	if (actual !== expected) {
		await writeFile(join(LOG_DIR, `turn-${n}.diff`), `expected:\n${expected}\nactual:\n${actual}\n`);
		throw Object.assign(new Error(`turn ${n} output mismatch`), { code: 92 });
	}

	const logText = await readFile(afterLog, "utf8").catch(() => "");
	if (turn > 1 && logText.includes("forcing full prompt re-processing") && !compactionBaselineReset) {
		throw Object.assign(new Error(`turn ${n} full-prefill warning detected before compaction`), { code: 93 });
	}
	const maxEval = maxPromptEvalTokens(logText);
	if (turn > 1 && maxEval > MAX_PROMPT_EVAL_POST_FIRST && !compactionBaselineReset) {
		throw Object.assign(
			new Error(`turn ${n} prompt eval too high before compaction: ${maxEval} > ${MAX_PROMPT_EVAL_POST_FIRST}`),
			{ code: 94 },
		);
	}

	console.log(`turn ${n} ok max_prompt_eval=${maxEval}`);
}

async function runInterruptionProbe() {
	const before = await lineCount();
	const stdoutPath = join(LOG_DIR, "interruption.out");
	const stderrPath = join(LOG_DIR, "interruption.err");
	const afterLog = join(LOG_DIR, "interruption.llama.log");
	console.log("interruption probe start");
	const { child, promise } = startP(
		basePArgs(
			INTERRUPTION_MAX_TOKENS,
			"Interruption probe. Before using any tool or finish_work, write a long numbered list from 1 to 1000 with a short cache-stability sentence for each number. After the list, call finish_work.",
		),
		stdoutPath,
		stderrPath,
	);
	await sleep(6000);
	child.current?.kill("SIGINT");
	await sleep(2000);
	child.current?.kill("SIGTERM");
	await promise.catch(() => undefined);
	await fetchLogSince(before, afterLog);
	const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
	const stderr = await readFile(stderrPath, "utf8").catch(() => "");
	if (`${stdout}\n${stderr}`.includes("cannot continue from message role: assistant")) {
		throw Object.assign(new Error("interruption probe hit assistant-role regression"), { code: 95 });
	}
	console.log("interruption probe done");
}

async function runQueueProbe() {
	console.log("queue probe start");
	const queueA = startP(
		basePArgs(
			QUEUE_A_MAX_TOKENS,
			"Queue probe A. Write a numbered list from 1 to 500, then call finish_work.",
			"p-cache-queue-a",
		),
		join(LOG_DIR, "queue-a.out"),
		join(LOG_DIR, "queue-a.err"),
	);
	await sleep(1000);
	const queueB = startP(
		basePArgs(QUEUE_B_MAX_TOKENS, "Queue probe B. Reply with exactly QUEUE_B_DONE, then call finish_work.", "p-cache-queue-b"),
		join(LOG_DIR, "queue-b.out"),
		join(LOG_DIR, "queue-b.err"),
	);
	await sleep(3000);
	const status = await fetchStatus();
	const queueStatus = {
		total_active_requests: status.total_active_requests,
		total_queue_depth: status.total_queue_depth,
		workers: status.workers
			.filter((worker) => worker.id === "mini-pc")
			.map((worker) => ({
				id: worker.id,
				status: worker.status,
				active_requests: worker.active_requests,
				queue_depth: worker.queue_depth,
			})),
	};
	await writeFile(join(LOG_DIR, "queue-status.json"), `${JSON.stringify(queueStatus, null, 2)}\n`);
	console.log(JSON.stringify(queueStatus, null, 2));
	await Promise.all([queueA.promise.catch(() => undefined), queueB.promise.catch(() => undefined)]);
	console.log("queue probe done");
}

async function fetchStatus() {
	const response = await fetch(`http://${ORCHESTRATOR_HOST}:${ORCHESTRATOR_PORT}/api/status`, {
		signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`status failed: ${response.status}`);
	}
	return response.json();
}

async function cleanupSlot(reason) {
	if (!CLEANUP_SLOT_ON_FAILURE) return;
	const url = `http://${LLAMA_SERVER_HOST}:${LLAMA_SERVER_PORT}/slots/${LLAMA_SLOT_ID}?action=erase`;
	try {
		const response = await fetch(url, {
			method: "POST",
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
		const text = await response.text();
		console.error(`cleanup slot after ${reason}: ${response.status} ${text}`);
	} catch (error) {
		console.error(`cleanup slot after ${reason} failed: ${error.message ?? String(error)}`);
	}
}

function statusSubset(status, includeSwitching = false) {
	return {
		total_active_requests: status.total_active_requests,
		total_queue_depth: status.total_queue_depth,
		workers: status.workers
			.filter((worker) => worker.id === "mini-pc" || worker.id === "lms-micro")
			.map((worker) => ({
				id: worker.id,
				machine_id: worker.machine_id,
				server_id: worker.server_id,
				status: worker.status,
				current_model: worker.current_model,
				active_requests: worker.active_requests,
				queue_depth: worker.queue_depth,
				...(includeSwitching ? { switching_to: worker.switching_to } : {}),
				...(worker.target_load ? { target_load: worker.target_load } : {}),
			})),
	};
}

async function printSummary() {
	const files = await readdir(LOG_DIR);
	let count = 0;
	let max = 0;
	for (const file of files) {
		if (!file.match(/^turn-\d+\.llama\.log$/u)) continue;
		const text = await readFile(join(LOG_DIR, file), "utf8");
		for (const line of text.split("\n")) {
			const match = line.match(/prompt eval time =.*\/\s*(\d+)\s+tokens/);
			if (match) {
				count++;
				max = Math.max(max, Number(match[1]));
			}
		}
	}
	console.log("summary");
	console.log(`prompt_eval_entries=${count} max_prompt_eval=${max}`);
}

async function main() {
	await rm(ROOT, { recursive: true, force: true });
	await ensureDirs();
	const proxy = await startProxy();
	try {
		await writeConfig(proxy.port);
		await writeInputs();
		console.log(`root ${ROOT}`);
		console.log(`model ${MODEL_ID}`);
		console.log("initial status");
		console.log(JSON.stringify(statusSubset(await fetchStatus()), null, 2));

		for (let turn = 1; turn <= TURNS; turn++) {
			if (turn === 9) {
				console.log("cold idle pause before turn 09");
				await sleep(20_000);
			}
			if (turn === 14) {
				await runInterruptionProbe();
			}
			await runTurn(turn);
		}

		await runQueueProbe();
		console.log("final status");
		console.log(JSON.stringify(statusSubset(await fetchStatus(), true), null, 2));
		await printSummary();
	} finally {
		await proxy.close();
	}
}

main().catch(async (error) => {
	console.error(error.message ?? String(error));
	await cleanupSlot("smoke failure");
	process.exit(typeof error.code === "number" ? error.code : 1);
});
