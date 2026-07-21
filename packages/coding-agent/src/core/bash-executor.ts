/**
 * Bash command execution with streaming support and cancellation.
 *
 * This module provides a unified bash execution implementation used by:
 * - AgentSession.executeBash() for interactive and RPC modes
 * - Direct calls from modes that need bash execution
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../utils/shell.ts";
import type { BashOperations } from "./tools/bash.ts";
import { DEFAULT_MAX_BYTES, truncateTail } from "./tools/truncate.ts";

// ============================================================================
// Types
// ============================================================================

export interface BashExecutorOptions {
	/** Callback for streaming output chunks (already sanitized) */
	onChunk?: (chunk: string) => void;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
}

export interface BashResult {
	/** Combined stdout + stderr output (sanitized, possibly truncated) */
	output: string;
	/** Process exit code (undefined if killed/cancelled) */
	exitCode: number | undefined;
	/** Whether the command was cancelled via signal */
	cancelled: boolean;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Path to temp file containing full output (if output exceeded truncation threshold) */
	fullOutputPath?: string;
	/** Individual exit codes from each segment of a shell pipeline (populated when pipefail is enabled) */
	pipelineExitCodes?: number[];
	/** Semantic interpretation of the result: "success", "failure", or "cancelled" */
	semanticStatus: "success" | "failure" | "cancelled";
}

// ============================================================================
// Implementation
// ============================================================================

function extractPipelineExitCodes(output: string): number[] | undefined {
	const lines = output.split("\n");
	for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
		const line = lines[i].trim();
		const match = line.match(/^(\d+(\s+\d+)*)$/);
		if (match) {
			const codes = match[1]
				.split(/\s+/)
				.map((s) => parseInt(s, 10))
				.filter((n) => !Number.isNaN(n));
			if (codes.length > 1) return codes;
		}
	}
	return undefined;
}

/**
 * Execute a bash command using custom BashOperations.
 * Used for remote execution (SSH, containers, etc.).
 */
export async function executeBashWithOperations(
	command: string,
	cwd: string,
	operations: BashOperations,
	options?: BashExecutorOptions,
): Promise<BashResult> {
	const outputChunks: string[] = [];
	let outputBytes = 0;
	const maxOutputBytes = DEFAULT_MAX_BYTES * 2;

	let tempFilePath: string | undefined;
	let tempFileStream: WriteStream | undefined;
	let totalBytes = 0;

	const ensureTempFile = () => {
		if (tempFilePath) {
			return;
		}
		const id = randomBytes(8).toString("hex");
		tempFilePath = join(tmpdir(), `p-bash-${id}.log`);
		tempFileStream = createWriteStream(tempFilePath);
		for (const chunk of outputChunks) {
			tempFileStream.write(chunk);
		}
	};

	const decoder = new TextDecoder();

	const onData = (data: Buffer) => {
		totalBytes += data.length;

		// Sanitize: strip ANSI, replace binary garbage, normalize newlines
		const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");

		// Start writing to temp file if exceeds threshold
		if (totalBytes > DEFAULT_MAX_BYTES) {
			ensureTempFile();
		}

		if (tempFileStream) {
			tempFileStream.write(text);
		}

		// Keep rolling buffer
		outputChunks.push(text);
		outputBytes += text.length;
		while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
			const removed = outputChunks.shift()!;
			outputBytes -= removed.length;
		}

		// Stream to callback
		if (options?.onChunk) {
			options.onChunk(text);
		}
	};

	try {
		const result = await operations.exec(command, cwd, {
			onData,
			signal: options?.signal,
		});

		const fullOutput = outputChunks.join("");
		const truncationResult = truncateTail(fullOutput);
		if (truncationResult.truncated) {
			ensureTempFile();
		}
		if (tempFileStream) {
			tempFileStream.end();
		}
		const cancelled = options?.signal?.aborted ?? false;
		const rawOutput = outputChunks.join("");
		const pipelineExitCodes = extractPipelineExitCodes(rawOutput);
		const semanticStatus = cancelled ? "cancelled" : (result.exitCode ?? 0) === 0 ? "success" : "failure";

		return {
			output: truncationResult.truncated ? truncationResult.content : rawOutput,
			exitCode: cancelled ? undefined : (result.exitCode ?? undefined),
			cancelled,
			truncated: truncationResult.truncated,
			fullOutputPath: tempFilePath,
			pipelineExitCodes,
			semanticStatus,
		};
	} catch (err) {
		/* Check if it was an abort */
		if (options?.signal?.aborted) {
			const fullOutput = outputChunks.join("");
			const truncationResult = truncateTail(fullOutput);
			if (truncationResult.truncated) {
				ensureTempFile();
			}
			if (tempFileStream) {
				tempFileStream.end();
			}
			const pipelineExitCodes = extractPipelineExitCodes(fullOutput);
			return {
				output: truncationResult.truncated ? truncationResult.content : fullOutput,
				exitCode: undefined,
				cancelled: true,
				truncated: truncationResult.truncated,
				fullOutputPath: tempFilePath,
				pipelineExitCodes,
				semanticStatus: "cancelled",
			};
		}

		if (tempFileStream) {
			tempFileStream.end();
		}

		throw err;
	}
}
