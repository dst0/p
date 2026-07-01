/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	streamSimple,
	type ToolResultMessage,
	validateToolArguments,
} from "@dst0/p-ai";
import {
	type CompletionMode,
	createFinishWorkTool,
	FINISH_WORK_TOOL_NAME,
	isFinishWorkToolResult,
} from "./completion-protocol.ts";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolCall,
	AgentToolResult,
	StreamFn,
} from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

const DEFAULT_COMPLETION_MODE: CompletionMode = "explicit_finish";
const DEFAULT_MAX_TURNS = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_NO_PROGRESS_TURNS = 5;
const DEFAULT_MAX_MALFORMED_TOOL_RETRIES = 3;
const DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES = 3;
const DEFAULT_MAX_MISSING_FINISH_RETRIES = 15;

const MISSING_FINISH_WORK_REPAIR_MESSAGE =
	"The task is not complete because you did not call `finish_work`.\n" +
	"Continue working by calling the appropriate tools, or call `finish_work` if you believe the work is genuinely done.\n" +
	"Do not provide a normal assistant final answer in this mode.";

const MALFORMED_TOOL_CALL_REPAIR_MESSAGE =
	"Your previous tool call appears to be incomplete, malformed, or truncated.\n" +
	"Re-emit the intended tool call in valid form, or call `finish_work` if the task is complete.\n" +
	"Do not explain. Call a tool.";

const MIXED_FINISH_WORK_REPAIR_MESSAGE =
	"Do not mix `finish_work` with other tool calls.\n" +
	"Call non-terminal tools first, or call only `finish_work` when the task is complete.\n" +
	"Do not explain. Call a tool.";

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	void runAgentLoop(
		prompts,
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	void runAgentLoopContinue(
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	const newMessages: AgentMessage[] = [...prompts];
	const currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...prompts],
	};

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const prompt of prompts) {
		await emit({ type: "message_start", message: prompt });
		await emit({ type: "message_end", message: prompt });
	}

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
	return newMessages;
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = { ...context };

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
	return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

type CompletionProtocolState = {
	turns: number;
	noProgressTurns: number;
	malformedToolRetries: number;
	emptyAssistantRetries: number;
	missingFinishRetries: number;
	allowImplicitCompletion: boolean;
};

type CompletionProtocolLimits = Required<NonNullable<AgentLoopConfig["completionLimits"]>>;

type CompletionProtocolRepair = {
	reason: "malformed_or_truncated_tool_call" | "missing_finish_work_or_tool_call" | "mixed_finish_work_tool_call";
	message: string;
	event: "malformed_tool_call_retry" | "missing_finish_work_retry";
};

function createCompletionProtocolState(): CompletionProtocolState {
	return {
		turns: 0,
		noProgressTurns: 0,
		malformedToolRetries: 0,
		emptyAssistantRetries: 0,
		missingFinishRetries: 0,
		allowImplicitCompletion: false,
	};
}

function resolveCompletionMode(config: AgentLoopConfig): CompletionMode {
	return config.completionMode ?? DEFAULT_COMPLETION_MODE;
}

function isCompletionProtocolEnabled(mode: CompletionMode): boolean {
	return mode === "explicit_finish" || mode === "hybrid";
}

function resolveCompletionLimits(config: AgentLoopConfig, mode: CompletionMode): CompletionProtocolLimits {
	const explicitFinishDefault = mode === "explicit_finish" ? Number.POSITIVE_INFINITY : undefined;
	return {
		maxTurns: config.completionLimits?.maxTurns ?? explicitFinishDefault ?? DEFAULT_MAX_TURNS,
		maxNoProgressTurns:
			config.completionLimits?.maxNoProgressTurns ?? explicitFinishDefault ?? DEFAULT_MAX_NO_PROGRESS_TURNS,
		maxMalformedToolRetries:
			config.completionLimits?.maxMalformedToolRetries ??
			explicitFinishDefault ??
			DEFAULT_MAX_MALFORMED_TOOL_RETRIES,
		maxEmptyAssistantRetries:
			config.completionLimits?.maxEmptyAssistantRetries ??
			explicitFinishDefault ??
			DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES,
		maxMissingFinishRetries:
			config.completionLimits?.maxMissingFinishRetries ??
			explicitFinishDefault ??
			DEFAULT_MAX_MISSING_FINISH_RETRIES,
	};
}

function withCompletionProtocolTools(context: AgentContext, mode: CompletionMode): AgentContext {
	if (!isCompletionProtocolEnabled(mode)) {
		return context;
	}
	const tools = context.tools ?? [];
	return {
		...context,
		tools: [...tools.filter((tool) => tool.name !== FINISH_WORK_TOOL_NAME), createFinishWorkTool()],
	};
}

function createProtocolRepairMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		metadata: { pInternal: "completion_protocol_repair" },
		timestamp: Date.now(),
	};
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.flatMap((block) => {
			if (block.type === "text") return [block.text];
			if (block.type === "thinking") return [block.thinking];
			return [];
		})
		.join("\n");
}

function isEmptyAssistantMessage(message: AssistantMessage, toolCalls: AgentToolCall[]): boolean {
	return toolCalls.length === 0 && getAssistantText(message).trim().length === 0;
}

function hasMalformedOrTruncatedToolCall(message: AssistantMessage, toolCalls: AgentToolCall[]): boolean {
	if (message.stopReason === "length") {
		return true;
	}
	if (toolCalls.length > 0) {
		return false;
	}
	const text = getAssistantText(message);
	return (
		/<tool_call\b/i.test(text) ||
		/<function(?:=|\s)/i.test(text) ||
		/"tool_calls?"\s*:/i.test(text) ||
		/"function_call"\s*:/i.test(text)
	);
}

function detectCompletionProtocolRepair(
	message: AssistantMessage,
	toolCalls: AgentToolCall[],
	hasMoreToolCalls: boolean,
): CompletionProtocolRepair | undefined {
	if (hasMalformedOrTruncatedToolCall(message, toolCalls)) {
		return {
			reason: "malformed_or_truncated_tool_call",
			message: MALFORMED_TOOL_CALL_REPAIR_MESSAGE,
			event: "malformed_tool_call_retry",
		};
	}

	const finishWorkCalls = toolCalls.filter((toolCall) => toolCall.name === FINISH_WORK_TOOL_NAME);
	if (finishWorkCalls.length > 0 && toolCalls.length !== 1) {
		return {
			reason: "mixed_finish_work_tool_call",
			message: MIXED_FINISH_WORK_REPAIR_MESSAGE,
			event: "malformed_tool_call_retry",
		};
	}

	if (toolCalls.length === 0 || !hasMoreToolCalls) {
		return {
			reason: "missing_finish_work_or_tool_call",
			message: MISSING_FINISH_WORK_REPAIR_MESSAGE,
			event: "missing_finish_work_retry",
		};
	}

	return undefined;
}

function resetCompletionProgress(state: CompletionProtocolState): void {
	state.noProgressTurns = 0;
	state.emptyAssistantRetries = 0;
	state.malformedToolRetries = 0;
	state.missingFinishRetries = 0;
}

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createProtocolFailureMessage(config: AgentLoopConfig, diagnostic: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: diagnostic }],
		api: config.model.api,
		provider: config.model.provider,
		model: config.model.id,
		usage: EMPTY_USAGE,
		stopReason: "error",
		errorMessage: diagnostic,
		timestamp: Date.now(),
	};
}

async function emitProtocolFailure(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	emit: AgentEventSink,
	mode: CompletionMode,
	event: "max_turns_without_finish_work" | "no_progress_stop",
	diagnostic: string,
	turnAlreadyStarted: boolean,
): Promise<void> {
	await emit({ type: "completion_protocol", completionMode: mode, event, reason: diagnostic });
	if (!turnAlreadyStarted) {
		await emit({ type: "turn_start" });
	}
	const message = createProtocolFailureMessage(config, diagnostic);
	currentContext.messages.push(message);
	newMessages.push(message);
	await emit({ type: "message_start", message });
	await emit({ type: "message_end", message });
	await emit({ type: "turn_end", message, toolResults: [] });
	await emit({ type: "agent_end", messages: newMessages });
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	initialContext: AgentContext,
	newMessages: AgentMessage[],
	initialConfig: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<void> {
	let config = initialConfig;
	let completionMode = resolveCompletionMode(config);
	const completionState = createCompletionProtocolState();
	let currentContext = withCompletionProtocolTools(initialContext, completionMode);
	let firstTurn = true;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	if (isCompletionProtocolEnabled(completionMode)) {
		await emit({ type: "completion_protocol", completionMode, event: "completion_mode" });
	}

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				await emit({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					await emit({ type: "message_start", message });
					await emit({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			completionMode = resolveCompletionMode(config);
			currentContext = withCompletionProtocolTools(currentContext, completionMode);
			const completionLimits = resolveCompletionLimits(config, completionMode);
			if (isCompletionProtocolEnabled(completionMode) && completionState.turns >= completionLimits.maxTurns) {
				await emitProtocolFailure(
					currentContext,
					newMessages,
					config,
					emit,
					completionMode,
					"max_turns_without_finish_work",
					`Agent stopped because the model did not call \`finish_work\` within ${completionLimits.maxTurns} turns.`,
					true,
				);
				return;
			}
			completionState.turns++;

			// Stream assistant response
			const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
			newMessages.push(message);

			const assistantErrored = message.stopReason === "error";
			if (message.stopReason === "aborted" || (assistantErrored && !isCompletionProtocolEnabled(completionMode))) {
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			// Check for tool calls
			const toolCalls = message.content.filter((c) => c.type === "toolCall");
			const protocolRepairBeforeExecution = isCompletionProtocolEnabled(completionMode)
				? detectCompletionProtocolRepair(message, toolCalls, true)
				: undefined;

			const toolResults: ToolResultMessage[] = [];
			hasMoreToolCalls = false;
			if (toolCalls.length > 0 && !protocolRepairBeforeExecution && !assistantErrored) {
				const executedToolBatch = await executeToolCalls(currentContext, message, config, signal, emit);
				toolResults.push(...executedToolBatch.messages);
				hasMoreToolCalls = !executedToolBatch.terminate;

				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			await emit({ type: "turn_end", message, toolResults });

			if (isCompletionProtocolEnabled(completionMode) && !completionState.allowImplicitCompletion) {
				const finishWorkResult = toolResults.find((result) => isFinishWorkToolResult(result) && !result.isError);
				if (finishWorkResult) {
					await emit({ type: "completion_protocol", completionMode, event: "finish_work_called" });
					await emit({ type: "agent_end", messages: newMessages });
					return;
				}

				const protocolRepair =
					protocolRepairBeforeExecution ?? detectCompletionProtocolRepair(message, toolCalls, hasMoreToolCalls);
				if (protocolRepair) {
					completionState.noProgressTurns++;
					if (protocolRepair.event === "malformed_tool_call_retry") {
						completionState.malformedToolRetries++;
					}
					if (protocolRepair.reason === "missing_finish_work_or_tool_call") {
						completionState.missingFinishRetries++;
					}
					if (isEmptyAssistantMessage(message, toolCalls)) {
						completionState.emptyAssistantRetries++;
					}

					const malformedExceeded =
						completionState.malformedToolRetries > completionLimits.maxMalformedToolRetries;
					const emptyExceeded = completionState.emptyAssistantRetries > completionLimits.maxEmptyAssistantRetries;
					const noProgressExceeded = completionState.noProgressTurns > completionLimits.maxNoProgressTurns;
					if (malformedExceeded || emptyExceeded || noProgressExceeded) {
						await emitProtocolFailure(
							currentContext,
							newMessages,
							config,
							emit,
							completionMode,
							"no_progress_stop",
							`Agent stopped because the model did not call \`finish_work\` and made no progress for ${completionState.noProgressTurns} turns.`,
							false,
						);
						return;
					}

					if (
						completionMode === "hybrid" &&
						protocolRepair.reason === "missing_finish_work_or_tool_call" &&
						completionState.missingFinishRetries > completionLimits.maxMissingFinishRetries
					) {
						completionState.allowImplicitCompletion = true;
					} else {
						await emit({
							type: "completion_protocol",
							completionMode,
							event: protocolRepair.event,
							retry:
								protocolRepair.event === "malformed_tool_call_retry"
									? completionState.malformedToolRetries
									: completionState.missingFinishRetries,
							maxRetries:
								protocolRepair.event === "malformed_tool_call_retry"
									? completionLimits.maxMalformedToolRetries
									: completionMode === "hybrid"
										? completionLimits.maxMissingFinishRetries
										: completionLimits.maxTurns,
							reason: protocolRepair.reason,
						});
						const repairMessage = createProtocolRepairMessage(protocolRepair.message);
						await emit({ type: "message_start", message: repairMessage });
						await emit({ type: "message_end", message: repairMessage });
						currentContext.messages.push(repairMessage);
						newMessages.push(repairMessage);
						hasMoreToolCalls = true;
						continue;
					}
				} else if (toolCalls.length > 0) {
					resetCompletionProgress(completionState);
				}
			}

			const nextTurnContext = {
				message,
				toolResults,
				context: currentContext,
				newMessages,
			};
			const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
			if (nextTurnSnapshot) {
				currentContext = nextTurnSnapshot.context ?? currentContext;
				config = {
					...config,
					model: nextTurnSnapshot.model ?? config.model,
					reasoning:
						nextTurnSnapshot.thinkingLevel === undefined
							? config.reasoning
							: nextTurnSnapshot.thinkingLevel === "off"
								? undefined
								: nextTurnSnapshot.thinkingLevel,
				};
			}

			const canStopImplicitly =
				!isCompletionProtocolEnabled(completionMode) || completionState.allowImplicitCompletion;
			if (
				canStopImplicitly &&
				(await config.shouldStopAfterTurn?.({
					message,
					toolResults,
					context: currentContext,
					newMessages,
				}))
			) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			pendingMessages = (await config.getSteeringMessages?.()) || [];
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			continue;
		}

		// No more messages, exit
		break;
	}

	await emit({ type: "agent_end", messages: newMessages });
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;

	// Resolve API key (important for expiring tokens)
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	await emit({ type: "request_start", model: config.model });

	const response = await streamFunction(config.model, llmContext, {
		...config,
		reasoning: config.reasoning === "off" ? undefined : config.reasoning,
		apiKey: resolvedApiKey,
		signal,
	});

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	// Progress tracking: prefill (model processing the prompt) and gen (token generation)
	let prefillStartMs: number | null = null;
	let genStartMs: number | null = null;
	let tokenCount = 0;
	let lastGenProgressMs: number | null = null;
	let intervalTokenCount = 0;
	const GEN_PROGRESS_INTERVAL_MS = 1000;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				prefillStartMs = Date.now();
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				await emit({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_start":
			case "thinking_start":
			case "toolcall_start": {
				// First content block start: prefill is done, generation begins
				if (prefillStartMs && !genStartMs) {
					await emit({
						type: "message_update",
						assistantMessageEvent: {
							type: "prefill_progress",
							elapsedMs: Date.now() - prefillStartMs,
							partial: partialMessage,
						} as AssistantMessageEvent,
						message: partialMessage!,
					});
					genStartMs = Date.now();
					lastGenProgressMs = genStartMs;
					tokenCount = 0;
					intervalTokenCount = 0;
				}
				// Also emit the normal message_update for the event itself
				partialMessage = event.partial;
				context.messages[context.messages.length - 1] = partialMessage;
				await emit({
					type: "message_update",
					assistantMessageEvent: event,
					message: partialMessage,
				});
				break;
			}

			case "text_delta":
			case "thinking_delta":
			case "toolcall_delta": {
				if (genStartMs) {
					tokenCount++;
					intervalTokenCount++;
					const now = Date.now();
					if (lastGenProgressMs != null && now - lastGenProgressMs >= GEN_PROGRESS_INTERVAL_MS) {
						const intervalElapsed = (now - lastGenProgressMs) / 1000;
						if (intervalElapsed > 0) {
							await emit({
								type: "message_update",
								assistantMessageEvent: {
									type: "gen_progress",
									tokensPerSecond: Math.round(intervalTokenCount / intervalElapsed),
									tokens: tokenCount,
									partial: event.partial,
								} as AssistantMessageEvent,
								message: partialMessage!,
							});
						}
						lastGenProgressMs = now;
						intervalTokenCount = 0;
					}
				}
				// Also emit the normal message_update for the event itself
				partialMessage = event.partial;
				context.messages[context.messages.length - 1] = partialMessage;
				await emit({
					type: "message_update",
					assistantMessageEvent: event,
					message: partialMessage,
				});
				break;
			}

			case "text_end":
			case "thinking_end":
			case "toolcall_end":
			case "prefill_progress":
			case "gen_progress":
			case "queue_progress": {
				partialMessage = event.partial;
				context.messages[context.messages.length - 1] = partialMessage;
				await emit({
					type: "message_update",
					assistantMessageEvent: event,
					message: partialMessage,
				});
				break;
			}

			case "done":
			case "error": {
				const finalMessage = recoverMisplacedToolCalls(await response.result(), context.tools);
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					await emit({ type: "message_start", message: { ...finalMessage } });
				}
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	const finalMessage = recoverMisplacedToolCalls(await response.result(), context.tools);
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return finalMessage;
}

function recoverMisplacedToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AssistantMessage {
	if (message.content.some((block) => block.type === "toolCall")) {
		return message;
	}
	const toolCalls = extractMisplacedToolCalls(message, tools);
	if (toolCalls.length === 0) {
		return message;
	}
	return {
		...message,
		content: [...removeRecoveredXmlToolCallMarkup(message).content, ...toolCalls],
		stopReason: "toolUse",
	};
}

function removeRecoveredXmlToolCallMarkup(message: AssistantMessage): AssistantMessage {
	return {
		...message,
		content: message.content
			.map((block) => {
				if (block.type === "text") {
					return { ...block, text: removeXmlToolCallBlocksOutsideFences(block.text) };
				}
				if (block.type === "thinking") {
					return { ...block, thinking: removeXmlToolCallBlocksOutsideFences(block.thinking) };
				}
				return block;
			})
			.filter((block) => {
				if (block.type === "text") return block.text.trim().length > 0;
				if (block.type === "thinking") return block.thinking.trim().length > 0;
				return true;
			}),
	};
}

function removeXmlToolCallBlocksOutsideFences(value: string): string {
	const chunks: string[] = [];
	const outsideFenceBuffer: string[] = [];
	const flushOutsideFenceBuffer = () => {
		if (outsideFenceBuffer.length === 0) return;
		chunks.push(outsideFenceBuffer.join("").replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, ""));
		outsideFenceBuffer.length = 0;
	};
	const lines = value.split(/(\r?\n)/);
	let activeFence: string | undefined;
	for (let index = 0; index < lines.length; index += 2) {
		const line = lines[index] ?? "";
		const lineEnd = lines[index + 1] ?? "";
		const fenceMatch = line.match(/^\s*(```+|~~~+)/);
		if (fenceMatch) {
			if (activeFence === undefined) {
				flushOutsideFenceBuffer();
			}
			activeFence = activeFence === undefined ? fenceMatch[1] : undefined;
			chunks.push(line, lineEnd);
			continue;
		}
		if (activeFence !== undefined) {
			chunks.push(line, lineEnd);
			continue;
		}
		outsideFenceBuffer.push(line, lineEnd);
	}
	flushOutsideFenceBuffer();
	return chunks
		.join("")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function extractMisplacedToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AgentToolCall[] {
	const toolNames = new Set(tools?.map((tool) => tool.name) ?? []);
	const text = message.content
		.flatMap((block) => {
			if (block.type === "text") return [block.text];
			if (block.type === "thinking") return [block.thinking];
			return [];
		})
		.join("\n");
	const toolCalls: AgentToolCall[] = [];
	const blockMatches = stripMarkdownCodeFences(text).matchAll(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi);
	let index = 0;
	for (const blockMatch of blockMatches) {
		for (const parsed of parseMisplacedToolCallBlock(blockMatch[1])) {
			const toolCall = createRecoveredToolCall(parsed, toolNames, index);
			toolCalls.push(toolCall);
			index++;
		}
	}
	for (const parsed of extractMisplacedJsonToolCalls(text)) {
		const key = `${parsed.name}:${JSON.stringify(parsed.arguments)}`;
		const duplicate = toolCalls.some((toolCall) => `${toolCall.name}:${JSON.stringify(toolCall.arguments)}` === key);
		if (duplicate) continue;
		const toolCall = createRecoveredToolCall(parsed, toolNames, index);
		toolCalls.push(toolCall);
		index++;
	}
	return toolCalls;
}

function createRecoveredToolCall(
	parsed: ParsedMisplacedToolCall,
	toolNames: Set<string>,
	index: number,
): AgentToolCall {
	const knownTool = toolNames.size === 0 || toolNames.has(parsed.name);
	return {
		type: "toolCall",
		id: `recovered_${Date.now()}_${index}_${sanitizeToolCallIdSegment(parsed.name)}`,
		name: parsed.name,
		arguments: knownTool ? parsed.arguments : {},
	};
}

function extractMisplacedJsonToolCalls(text: string): ParsedMisplacedToolCall[] {
	const stripped = stripMarkdownCodeFences(text).trim();
	const calls = parseMisplacedToolCallJson(stripped);
	for (const block of collectMarkdownCodeFences(text)) {
		if (!isToolJsonFence(block.language)) continue;
		calls.push(...parseMisplacedToolCallJson(block.body.trim()));
	}
	return calls;
}

function collectMarkdownCodeFences(value: string): Array<{ language: string; body: string }> {
	const blocks: Array<{ language: string; body: string }> = [];
	const lines = value.split(/\r?\n/);
	let activeFence: { marker: string; language: string; lines: string[] } | undefined;
	for (const line of lines) {
		const fenceMatch = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_.:-]*)?.*$/);
		if (!fenceMatch) {
			activeFence?.lines.push(line);
			continue;
		}
		const marker = fenceMatch[1];
		if (!activeFence) {
			activeFence = { marker, language: fenceMatch[2] ?? "", lines: [] };
			continue;
		}
		if (marker[0] === activeFence.marker[0]) {
			blocks.push({ language: activeFence.language.toLowerCase(), body: activeFence.lines.join("\n") });
			activeFence = undefined;
		} else {
			activeFence.lines.push(line);
		}
	}
	return blocks;
}

function isToolJsonFence(language: string): boolean {
	if (!language) return false;
	return /^(json|jsonc|tool|tools|tool_call|tool-call|function|functions)$/i.test(language);
}

interface ParsedMisplacedToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

function parseMisplacedToolCallBlock(block: string): ParsedMisplacedToolCall[] {
	const jsonCalls = parseMisplacedToolCallJson(block.trim());
	if (jsonCalls.length > 0) return jsonCalls;

	const calls: ParsedMisplacedToolCall[] = [];
	for (const functionMatch of block.matchAll(/<function=([A-Za-z0-9_.:-]+)\s*>([\s\S]*?)<\/function>/gi)) {
		const name = functionMatch[1]?.trim();
		if (!name) continue;
		calls.push({
			name,
			arguments: parseMisplacedToolArguments(functionMatch[2] ?? ""),
		});
	}
	for (const functionMatch of block.matchAll(/<function\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/function>/gi)) {
		const name = functionMatch[1]?.trim();
		if (!name) continue;
		calls.push({
			name,
			arguments: parseMisplacedToolArguments(functionMatch[2] ?? ""),
		});
	}
	const bareFunctionMatch = block.match(/<function>\s*([A-Za-z0-9_.:-]+)\s*<\/function>/i);
	const name = bareFunctionMatch?.[1]?.trim();
	if (name && calls.length === 0) {
		calls.push({
			name,
			arguments: parseMisplacedToolArguments(block),
		});
	}
	return calls;
}

function stripMarkdownCodeFences(value: string): string {
	const lines = value.split(/\r?\n/);
	let activeFence: string | undefined;
	return lines
		.map((line) => {
			const fenceMatch = line.match(/^\s*(```+|~~~+)/);
			if (fenceMatch) {
				const fence = fenceMatch[1][0];
				if (!activeFence) {
					activeFence = fence;
				} else if (activeFence === fence) {
					activeFence = undefined;
				}
				return "";
			}
			return activeFence ? "" : line;
		})
		.join("\n");
}

function parseMisplacedToolCallJson(block: string): ParsedMisplacedToolCall[] {
	if (!block) return [];
	if (!(block.startsWith("{") && block.endsWith("}")) && !(block.startsWith("[") && block.endsWith("]"))) {
		return [];
	}
	try {
		const parsed = JSON.parse(block) as unknown;
		return collectMisplacedToolCallsFromJson(parsed);
	} catch {
		return [];
	}
}

function collectMisplacedToolCallsFromJson(value: unknown): ParsedMisplacedToolCall[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => collectMisplacedToolCallsFromJson(item));
	}
	if (!isRecord(value)) return [];
	const nestedToolCalls = value.tool_calls ?? value.toolCalls ?? value.tools;
	if (Array.isArray(nestedToolCalls)) {
		return collectMisplacedToolCallsFromJson(nestedToolCalls);
	}
	const nestedFunction = value.function;
	if (isRecord(nestedFunction)) {
		const name = getStringValue(nestedFunction.name);
		if (!name) return [];
		return [
			{
				name,
				arguments: normalizeMisplacedToolArguments(
					nestedFunction.arguments ?? nestedFunction.input ?? value.arguments ?? value.input,
				),
			},
		];
	}
	const name = getStringValue(value.name ?? value.tool_name ?? value.toolName ?? value.tool ?? value.function);
	if (!name) return [];
	return [
		{
			name,
			arguments: normalizeMisplacedToolArguments(value.arguments ?? value.input ?? value.parameters ?? value.params),
		},
	];
}

function getStringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseMisplacedToolArguments(body: string): Record<string, unknown> {
	const parameters: Record<string, unknown> = {};
	for (const match of body.matchAll(/<parameter=([A-Za-z0-9_.:-]+)\s*>([\s\S]*?)<\/parameter>/gi)) {
		parameters[match[1]] = decodeXmlText(match[2].trim());
	}
	if (Object.keys(parameters).length > 0) {
		return parameters;
	}
	const argumentsMatch = body.match(/<arguments>\s*([\s\S]*?)\s*<\/arguments>/i);
	const jsonText = argumentsMatch?.[1]?.trim() ?? body.trim();
	if (jsonText.startsWith("{") && jsonText.endsWith("}")) {
		return normalizeMisplacedToolArguments(jsonText);
	}
	return {};
}

function normalizeMisplacedToolArguments(value: unknown): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return {};
	}
	const text = value.trim();
	if (!text.startsWith("{") || !text.endsWith("}")) {
		return {};
	}
	try {
		const parsed = JSON.parse(text) as unknown;
		if (isRecord(parsed)) return parsed;
	} catch {
		return {};
	}
	return {};
}

function decodeXmlText(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)))
		.replace(/&#([0-9]+);/g, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 10)))
		.replaceAll("&amp;", "&");
}

function sanitizeToolCallIdSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 48) || "tool";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	const hasSequentialToolCall = toolCalls.some(
		(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
	);
	if (config.toolExecution === "sequential" || hasSequentialToolCall) {
		return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
	}
	return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}

type ExecutedToolCallBatch = {
	messages: ToolResultMessage[];
	terminate: boolean;
};

async function executeToolCallsSequential(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallOutcome[] = [];
	const messages: ToolResultMessage[] = [];

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		let finalized: FinalizedToolCallOutcome;
		if (preparation.kind === "immediate") {
			finalized = {
				toolCall,
				result: preparation.result,
				isError: preparation.isError,
			};
		} else {
			const executed = await executePreparedToolCall(preparation, signal, emit);
			finalized = await finalizeExecutedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				executed,
				config,
				signal,
			);
		}

		await emitToolExecutionEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		finalizedCalls.push(finalized);
		messages.push(toolResultMessage);

		if (signal?.aborted) {
			break;
		}
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(finalizedCalls),
	};
}

async function executeToolCallsParallel(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallEntry[] = [];

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		if (preparation.kind === "immediate") {
			const finalized = {
				toolCall,
				result: preparation.result,
				isError: preparation.isError,
			} satisfies FinalizedToolCallOutcome;
			await emitToolExecutionEnd(finalized, emit);
			finalizedCalls.push(finalized);
			if (signal?.aborted) {
				break;
			}
			continue;
		}

		finalizedCalls.push(async () => {
			const executed = await executePreparedToolCall(preparation, signal, emit);
			const finalized = await finalizeExecutedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				executed,
				config,
				signal,
			);
			await emitToolExecutionEnd(finalized, emit);
			return finalized;
		});
		if (signal?.aborted) {
			break;
		}
	}

	const orderedFinalizedCalls = await Promise.all(
		finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
	);
	const messages: ToolResultMessage[] = [];
	for (const finalized of orderedFinalizedCalls) {
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
	};
}

type PreparedToolCall = {
	kind: "prepared";
	toolCall: AgentToolCall;
	tool: AgentTool<any>;
	args: unknown;
};

type ImmediateToolCallOutcome = {
	kind: "immediate";
	result: AgentToolResult<any>;
	isError: boolean;
};

type ExecutedToolCallOutcome = {
	result: AgentToolResult<any>;
	isError: boolean;
};

type FinalizedToolCallOutcome = {
	toolCall: AgentToolCall;
	result: AgentToolResult<any>;
	isError: boolean;
};

type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>);

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
	if (!tool.prepareArguments) {
		return toolCall;
	}
	const preparedArguments = tool.prepareArguments(toolCall.arguments);
	if (preparedArguments === toolCall.arguments) {
		return toolCall;
	}
	return {
		...toolCall,
		arguments: preparedArguments as Record<string, any>,
	};
}

async function prepareToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
	if (!tool) {
		return {
			kind: "immediate",
			result: createErrorToolResult(`Tool ${toolCall.name} not found`),
			isError: true,
		};
	}

	try {
		const preparedToolCall = prepareToolCallArguments(tool, toolCall);
		const validatedArgs = validateToolArguments(tool, preparedToolCall);
		if (config.beforeToolCall) {
			const beforeResult = await config.beforeToolCall(
				{
					assistantMessage,
					toolCall,
					args: validatedArgs,
					context: currentContext,
				},
				signal,
			);
			if (signal?.aborted) {
				return {
					kind: "immediate",
					result: createErrorToolResult("Operation aborted"),
					isError: true,
				};
			}
			if (beforeResult?.block) {
				return {
					kind: "immediate",
					result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
					isError: true,
				};
			}
		}
		if (signal?.aborted) {
			return {
				kind: "immediate",
				result: createErrorToolResult("Operation aborted"),
				isError: true,
			};
		}
		return {
			kind: "prepared",
			toolCall,
			tool,
			args: validatedArgs,
		};
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}

async function executePreparedToolCall(
	prepared: PreparedToolCall,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
	const updateEvents: Promise<void>[] = [];
	let acceptingUpdates = true;

	try {
		const result = await prepared.tool.execute(
			prepared.toolCall.id,
			prepared.args as never,
			signal,
			(partialResult) => {
				if (!acceptingUpdates) return;
				updateEvents.push(
					Promise.resolve(
						emit({
							type: "tool_execution_update",
							toolCallId: prepared.toolCall.id,
							toolName: prepared.toolCall.name,
							args: prepared.toolCall.arguments,
							partialResult,
						}),
					),
				);
			},
		);
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return { result, isError: false };
	} catch (error) {
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return {
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	} finally {
		acceptingUpdates = false;
	}
}

async function finalizeExecutedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedToolCall,
	executed: ExecutedToolCallOutcome,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
	let result = executed.result;
	let isError = executed.isError;

	if (config.afterToolCall) {
		try {
			const afterResult = await config.afterToolCall(
				{
					assistantMessage,
					toolCall: prepared.toolCall,
					args: prepared.args,
					result,
					isError,
					context: currentContext,
				},
				signal,
			);
			if (afterResult) {
				result = {
					content: afterResult.content ?? result.content,
					details: afterResult.details ?? result.details,
					terminate: afterResult.terminate ?? result.terminate,
				};
				isError = afterResult.isError ?? isError;
			}
		} catch (error) {
			result = createErrorToolResult(error instanceof Error ? error.message : String(error));
			isError = true;
		}
	}

	return {
		toolCall: prepared.toolCall,
		result,
		isError,
	};
}

function createErrorToolResult(message: string): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

async function emitToolExecutionEnd(finalized: FinalizedToolCallOutcome, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: finalized.result,
		isError: finalized.isError,
	});
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		content: finalized.result.content,
		details: finalized.result.details,
		isError: finalized.isError,
		timestamp: Date.now(),
	};
}

async function emitToolResultMessage(toolResultMessage: ToolResultMessage, emit: AgentEventSink): Promise<void> {
	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
}
