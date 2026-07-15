import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FooterDataProvider } from "../src/core/footer-data-provider.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type QueueEventContext = {
	isInitialized: boolean;
	footer: { invalidate: () => void };
	footerDataProvider: FooterDataProvider;
	getRecentModelSwitch: () => { fromModel: string; toModel: string } | undefined;
	getModelStatusLabel: (model: unknown) => string;
	ui: { requestRender: () => void };
	streamingComponent?: { updateContent: (message: unknown) => void };
	streamingMessage?: {
		role: "assistant";
		content: Array<{ type: "toolCall"; id: string; name: string; arguments: Record<string, never> }>;
		stopReason: string;
	};
	pendingTools: Map<string, never>;
	session: {
		retryAttempt: number;
		willRetryMessage: () => boolean;
	};
};

type InteractiveModePrivate = {
	handleEvent(this: QueueEventContext, event: unknown): Promise<void>;
};

const handleEvent = (InteractiveMode.prototype as unknown as InteractiveModePrivate).handleEvent;

describe("InteractiveMode orchestrator queue progress", () => {
	let tempDir: string;
	let provider: FooterDataProvider;
	let context: QueueEventContext;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "interactive-queue-progress-"));
		provider = new FooterDataProvider(tempDir);
		context = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			footerDataProvider: provider,
			getRecentModelSwitch: () => undefined,
			getModelStatusLabel: () => "tiny-model",
			ui: { requestRender: vi.fn() },
			streamingComponent: { updateContent: vi.fn() },
			pendingTools: new Map<string, never>(),
			session: {
				retryAttempt: 0,
				willRetryMessage: () => false,
			},
		};
	});

	afterEach(() => {
		provider.dispose();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("keeps exact server queue state through a synthetic sleep turn and retry start", async () => {
		const assistantMessage = {
			role: "assistant" as const,
			content: [
				{
					type: "toolCall" as const,
					id: "queue-ticket-a",
					name: "sleep",
					arguments: {},
				},
			],
			stopReason: "toolUse",
		};

		await handleEvent.call(context, {
			type: "message_update",
			message: assistantMessage,
			assistantMessageEvent: {
				type: "queue_progress",
				queue: "model",
				position: 3,
				queuedAhead: 2,
				workerId: "worker-1",
				ticketId: "queue-ticket-a",
				queuedAtMs: 1_700_000_000_000,
				queuedForMs: 2500,
			},
		});
		expect(provider.getQueuedProgress()).toEqual({
			queue: "model",
			position: 3,
			queuedAhead: 2,
			workerId: "worker-1",
			ticketId: "queue-ticket-a",
			queuedAt: 1_700_000_000_000,
			queuedForMs: 2500,
			source: "llm-orchestrator",
		});

		context.streamingMessage = assistantMessage;
		await handleEvent.call(context, { type: "message_end", message: assistantMessage });
		await handleEvent.call(context, { type: "request_start", model: { id: "tiny-model" } });

		expect(provider.getQueuedProgress()?.ticketId).toBe("queue-ticket-a");
		expect(provider.getQueuedProgress()?.queuedAt).toBe(1_700_000_000_000);
		expect(provider.getSendingProgress()).toBeUndefined();
	});

	it("uses sending only when no orchestrator ticket is being retried", async () => {
		const setModelSwitchProgress = vi.spyOn(provider, "setModelSwitchProgress");
		context.getRecentModelSwitch = () => ({ fromModel: "old-model", toModel: "tiny-model" });
		await handleEvent.call(context, { type: "request_start", model: { id: "tiny-model" } });

		expect(provider.getQueuedProgress()).toBeUndefined();
		expect(provider.getSendingProgress()).toEqual({ model: "tiny-model" });
		expect(setModelSwitchProgress).toHaveBeenCalledWith({ fromModel: "old-model", toModel: "tiny-model" });
	});
});
