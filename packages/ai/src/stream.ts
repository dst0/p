import "./providers/register-builtins.ts";

import { getApiProvider } from "./api-registry.ts";
import { getEnvApiKey } from "./env-api-keys.ts";
import { registerSessionResourceCleanup } from "./session-resources.ts";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.ts";

export { getEnvApiKey } from "./env-api-keys.ts";

const RUNTIME_CONTEXT_MARKERS = [
	"<project_memory>",
	"<project_rules>",
	"<repo_map>",
	"<subagent_profiles>",
	"<subagent_digests>",
] as const;

interface RuntimeContextInsertion {
	anchorKey: string;
	runtimeContext: string;
}

const sessionRuntimeContextInsertions = new Map<string, RuntimeContextInsertion[]>();

registerSessionResourceCleanup((sessionId) => {
	if (sessionId) {
		sessionRuntimeContextInsertions.delete(sessionId);
		return;
	}
	sessionRuntimeContextInsertions.clear();
});

function hasExplicitApiKey(apiKey: string | undefined): apiKey is string {
	return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function withEnvApiKey<TOptions extends StreamOptions>(
	model: Model<Api>,
	options: TOptions | undefined,
): TOptions | undefined {
	if (hasExplicitApiKey(options?.apiKey)) return options;
	const apiKey = getEnvApiKey(model.provider);
	if (!apiKey) return options;
	return { ...options, apiKey } as TOptions;
}

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

type SplitPromptContext = {
	stablePrompt?: string;
	runtimeContext?: string;
};

function splitRuntimeContext(systemPrompt: string | undefined): SplitPromptContext {
	if (!systemPrompt) return {};

	let runtimeStart = -1;
	for (const marker of RUNTIME_CONTEXT_MARKERS) {
		const index = systemPrompt.indexOf(marker);
		if (index !== -1 && (runtimeStart === -1 || index < runtimeStart)) {
			runtimeStart = index;
		}
	}

	if (runtimeStart === -1) {
		return { stablePrompt: systemPrompt };
	}

	const stablePrompt = systemPrompt.slice(0, runtimeStart).trimEnd();
	const runtimeContext = systemPrompt.slice(runtimeStart).trim();
	return {
		stablePrompt: stablePrompt.length > 0 ? stablePrompt : undefined,
		runtimeContext: runtimeContext.length > 0 ? runtimeContext : undefined,
	};
}

function createRuntimeContextMessage(runtimeContext: string): Message {
	return {
		role: "user",
		content: [
			{
				type: "text",
				text: [
					'<pi.runtime_context ephemeral="true">',
					"Current project/session context:",
					runtimeContext,
					"</pi.runtime_context>",
				].join("\n"),
			},
		],
		timestamp: 0,
	};
}

function messageContentKey(message: Message): string {
	return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

function runtimeAnchorKey(message: Message): string {
	return `${message.timestamp}:${messageContentKey(message)}`;
}

function findLastUserMessage(messages: Message[]): Message | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") {
			return messages[index];
		}
	}
	return undefined;
}

function rememberRuntimeContextInsertion(sessionId: string, anchor: Message, runtimeContext: string): void {
	const anchorKey = runtimeAnchorKey(anchor);
	const insertions = sessionRuntimeContextInsertions.get(sessionId) ?? [];
	if (!sessionRuntimeContextInsertions.has(sessionId)) {
		sessionRuntimeContextInsertions.set(sessionId, insertions);
	}
	if (insertions.some((insertion) => insertion.anchorKey === anchorKey)) {
		return;
	}
	insertions.push({ anchorKey, runtimeContext });
}

function replayRuntimeContextInsertions(messages: Message[], insertions: RuntimeContextInsertion[]): Message[] {
	if (insertions.length === 0) return messages;

	const insertionsByAnchor = new Map<string, RuntimeContextInsertion>();
	for (const insertion of insertions) {
		insertionsByAnchor.set(insertion.anchorKey, insertion);
	}

	const result: Message[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const insertion = insertionsByAnchor.get(runtimeAnchorKey(message));
			if (insertion) {
				result.push(createRuntimeContextMessage(insertion.runtimeContext));
			}
		}
		result.push(message);
	}
	return result;
}

function injectRuntimeContext(messages: Message[], runtimeContext: string): Message[] {
	const runtimeMessage = createRuntimeContextMessage(runtimeContext);
	let lastUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	if (lastUserIndex === -1) {
		return [...messages, runtimeMessage];
	}
	return [...messages.slice(0, lastUserIndex), runtimeMessage, ...messages.slice(lastUserIndex)];
}

function normalizeRuntimeContext(context: Context, sessionId: string | undefined): Context {
	const split = splitRuntimeContext(context.systemPrompt);
	const sessionInsertions = sessionId ? (sessionRuntimeContextInsertions.get(sessionId) ?? []) : [];
	if (!split.runtimeContext && sessionInsertions.length === 0) {
		return context;
	}
	if (sessionId && split.runtimeContext) {
		const latestUser = findLastUserMessage(context.messages);
		if (latestUser) {
			rememberRuntimeContextInsertion(sessionId, latestUser, split.runtimeContext);
		}
	}
	const messages = sessionId
		? replayRuntimeContextInsertions(context.messages, sessionRuntimeContextInsertions.get(sessionId) ?? [])
		: split.runtimeContext
			? injectRuntimeContext(context.messages, split.runtimeContext)
			: context.messages;
	return {
		...context,
		systemPrompt: split.stablePrompt,
		messages,
	};
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	return provider.stream(
		model,
		normalizeRuntimeContext(context, options?.sessionId),
		withEnvApiKey(model, options) as StreamOptions,
	);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	return provider.streamSimple(
		model,
		normalizeRuntimeContext(context, options?.sessionId),
		withEnvApiKey(model, options),
	);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}
