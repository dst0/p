import type { CompletionMode, CompletionProtocolLimits } from "@dst0/p-agent-core";
import type { Transport } from "@dst0/p-ai";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";
import { normalizePath, resolvePath } from "../utils/paths.ts";
import { DEFAULT_COMPACTION_SETTINGS } from "./compaction/default-settings.ts";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS, parseHttpIdleTimeoutMs } from "./http-dispatcher.ts";

export const DEFAULT_AGENT_RETRY_BASE_DELAY_MS = 500;
const COMPLETION_MODE_ALIASES = {
	implicit: "implicit",
	explicit: "explicit_finish",
	explicit_finish: "explicit_finish",
	hybrid: "hybrid",
} satisfies Record<string, CompletionMode>;

export interface CompactionSettings {
	enabled?: boolean; // default: true
	/** @deprecated Use triggerReserveTokens. */
	reserveTokens?: number;
	/** @deprecated Use keepRecentMinTokens/keepRecentMaxTokens. */
	keepRecentTokens?: number;
	triggerReserveTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.triggerReserveTokens
	triggerRatio?: number; // default: DEFAULT_COMPACTION_SETTINGS.triggerRatio
	keepRecentMinTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.keepRecentMinTokens
	keepRecentMaxTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.keepRecentMaxTokens
	summaryMaxTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.summaryMaxTokens
	renderedStateMaxTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.renderedStateMaxTokens
	targetContextTokens?: number; // default: DEFAULT_COMPACTION_SETTINGS.targetContextTokens
}

export interface BranchSummarySettings {
	reserveTokens?: number; // default: 16384 (tokens reserved for prompt + LLM response)
	skipPrompt?: boolean; // default: false - when true, skips "Summarize branch?" prompt and defaults to no summary
}

export interface ProviderRetrySettings {
	timeoutMs?: number; // SDK/provider request timeout in milliseconds
	maxRetries?: number; // SDK/provider retry attempts
	maxRetryDelayMs?: number; // default: 60000 (max server-requested delay before failing)
}

export interface RetrySettings {
	enabled?: boolean; // default: true
	maxRetries?: number; // default: 3
	baseDelayMs?: number; // default: 500 (exponential backoff: 0.5s, 1s, 2s)
	provider?: ProviderRetrySettings;
}

export interface TerminalSettings {
	showImages?: boolean; // default: true (only relevant if terminal supports images)
	imageWidthCells?: number; // default: 60 (preferred inline image width in terminal cells)
	clearOnShrink?: boolean; // default: false (clear empty rows when content shrinks)
	showTerminalProgress?: boolean; // default: false (OSC 9;4 terminal progress indicators)
	showTokenProgress?: boolean; // default: true (compact queued/prefill/generation footer progress)
	showTokenStats?: boolean; // default: true (cumulative ↑↓R W CH token counts in footer)
	showVersion?: boolean; // default: false (p agent version in footer)
}

export interface ImageSettings {
	autoResize?: boolean; // default: true (resize images to 2000x2000 max for better model compatibility)
	blockImages?: boolean; // default: false - when true, prevents all images from being sent to LLM providers
}

export interface ThinkingBudgetsSettings {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export interface FastResponderSettings {
	enabled?: boolean; // default: true when a responder or service model is configured
	provider?: string;
	model?: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	minContextTokens?: number; // default: 1000
	timeoutMs?: number; // default: 2000
	maxTokens?: number; // default: 120
}

export interface MarkdownSettings {
	codeBlockIndent?: string; // default: "  "
}

export interface WarningSettings {
	anthropicExtraUsage?: boolean; // default: true
}

export type DefaultProjectTrust = "ask" | "always" | "never";

export type TransportSetting = Transport;

/**
 * Package source for npm/git packages.
 * - String form: load all resources from the package
 * - Object form: filter which resources to load
 */
export type PackageSource =
	| string
	| {
			source: string;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
			themes?: string[];
	  };

export interface Settings {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	serviceProvider?: string; // Optional fast model provider for compaction/memory/tool-output extraction tasks
	serviceModel?: string; // Optional fast model id; falls back to current model when unavailable
	serviceThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	fastResponder?: FastResponderSettings; // Optional fast model response emitted before cold prefill
	defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	transport?: TransportSetting; // default: "auto"
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	completionMode?: CompletionMode | "explicit"; // default: "explicit"
	completionLimits?: CompletionProtocolLimits;
	enableToolResultContextExtraction?: boolean; // default: false - extract summaries from large tool results via service model
	theme?: string;
	compaction?: CompactionSettings;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
	quietStartup?: boolean;
	defaultProjectTrust?: DefaultProjectTrust; // default: "ask"; global setting only
	shellCommandPrefix?: string; // Prefix prepended to every bash command (e.g., "shopt -s expand_aliases" for alias support)
	npmCommand?: string[]; // Command used for npm package lookup/install operations, argv-style (e.g., ["mise", "exec", "node@20", "--", "npm"])
	collapseChangelog?: boolean; // Show condensed changelog after update (use /changelog for full)
	startupNotices?: boolean; // Show startup notices (changelog, version check, package updates) — disabled by default after rebrand
	enableInstallTelemetry?: boolean; // default: true - anonymous version/update ping after changelog-detected updates
	enableAnalytics?: boolean; // default: false - opt-in analytics data sharing
	trackingId?: string; // analytics tracking identifier, generated when analytics is enabled
	packages?: PackageSource[]; // Array of npm/git package sources (string or object with filtering)
	extensions?: string[]; // Array of local extension file paths or directories
	skills?: string[]; // Array of local skill file paths or directories
	prompts?: string[]; // Array of local prompt template paths or directories
	themes?: string[]; // Array of local theme file paths or directories
	enableSkillCommands?: boolean; // default: true - register skills as /skill:name commands
	terminal?: TerminalSettings;
	images?: ImageSettings;
	enabledModels?: string[]; // Model patterns for cycling (same format as --models CLI flag)
	doubleEscapeAction?: "fork" | "tree" | "none"; // Action for double-escape with empty editor (default: "tree")
	treeFilterMode?: "default" | "no-tools" | "user-only" | "labeled-only" | "all"; // Default filter when opening /tree
	thinkingBudgets?: ThinkingBudgetsSettings; // Custom token budgets for thinking levels
	editorPaddingX?: number; // Horizontal padding for input editor (default: 0)
	autocompleteMaxVisible?: number; // Max visible items in autocomplete dropdown (default: 5)
	showHardwareCursor?: boolean; // Show terminal cursor while still positioning it for IME
	markdown?: MarkdownSettings;
	warnings?: WarningSettings;
	sessionDir?: string; // Custom session storage directory (same format as --session-dir CLI flag)
	httpIdleTimeoutMs?: number; // HTTP header/body idle timeout in milliseconds; 0 disables it
	websocketConnectTimeoutMs?: number; // WebSocket connect/open handshake timeout in milliseconds; 0 disables it
}

/** Deep merge settings: project/overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	const result: Settings = { ...base };

	for (const key of Object.keys(overrides) as (keyof Settings)[]) {
		const overrideValue = overrides[key];
		const baseValue = base[key];

		if (overrideValue === undefined) {
			continue;
		}

		// For nested objects, merge recursively
		if (
			typeof overrideValue === "object" &&
			overrideValue !== null &&
			!Array.isArray(overrideValue) &&
			typeof baseValue === "object" &&
			baseValue !== null &&
			!Array.isArray(baseValue)
		) {
			(result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
		} else {
			// For primitives and arrays, override value wins
			(result as Record<string, unknown>)[key] = overrideValue;
		}
	}

	return result;
}

function parseTimeoutSetting(value: unknown, settingName: string): number | undefined {
	const timeoutMs = parseHttpIdleTimeoutMs(value);
	if (timeoutMs !== undefined) {
		return timeoutMs;
	}
	if (value !== undefined) {
		throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
	}
	return undefined;
}

function parsePositiveIntegerSetting(value: unknown, settingName: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
	}
	return Math.floor(value);
}

export type SettingsScope = "global" | "project";

export interface SettingsManagerCreateOptions {
	projectTrusted?: boolean;
}

export interface SettingsStorage {
	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

export interface SettingsError {
	scope: SettingsScope;
	error: Error;
}

export class FileSettingsStorage implements SettingsStorage {
	private globalSettingsPath: string;
	private projectSettingsPath: string;

	constructor(cwd: string, agentDir: string) {
		const resolvedCwd = resolvePath(cwd);
		const resolvedAgentDir = resolvePath(agentDir);
		this.globalSettingsPath = join(resolvedAgentDir, "settings.json");
		this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
	}

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
		const dir = dirname(path);

		let release: (() => void) | undefined;
		try {
			// Only create directory and lock if file exists or we need to write
			const fileExists = existsSync(path);
			if (fileExists) {
				release = this.acquireLockSyncWithRetry(path);
			}
			const current = fileExists ? readFileSync(path, "utf-8") : undefined;
			const next = fn(current);
			if (next !== undefined) {
				// Only create directory when we actually need to write
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}
				if (!release) {
					release = this.acquireLockSyncWithRetry(path);
				}
				writeFileSync(path, next, "utf-8");
			}
		} finally {
			if (release) {
				release();
			}
		}
	}
}

export class InMemorySettingsStorage implements SettingsStorage {
	private global: string | undefined;
	private project: string | undefined;

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const current = scope === "global" ? this.global : this.project;
		const next = fn(current);
		if (next !== undefined) {
			if (scope === "global") {
				this.global = next;
			} else {
				this.project = next;
			}
		}
	}
}

export class SettingsManager {
	private storage: SettingsStorage;
	private globalSettings: Settings;
	private projectSettings: Settings;
	private settings: Settings;
	private projectTrusted: boolean;
	private modifiedFields = new Set<keyof Settings>(); // Track global fields modified during session
	private modifiedNestedFields = new Map<keyof Settings, Set<string>>(); // Track global nested field modifications
	private modifiedProjectFields = new Set<keyof Settings>(); // Track project fields modified during session
	private modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>(); // Track project nested field modifications
	private globalSettingsLoadError: Error | null = null; // Track if global settings file had parse errors
	private projectSettingsLoadError: Error | null = null; // Track if project settings file had parse errors
	private writeQueue: Promise<void> = Promise.resolve();
	private errors: SettingsError[];

	private constructor(
		storage: SettingsStorage,
		initialGlobal: Settings,
		initialProject: Settings,
		globalLoadError: Error | null = null,
		projectLoadError: Error | null = null,
		initialErrors: SettingsError[] = [],
		projectTrusted = true,
	) {
		this.storage = storage;
		this.globalSettings = initialGlobal;
		this.projectSettings = initialProject;
		this.projectTrusted = projectTrusted;
		this.globalSettingsLoadError = globalLoadError;
		this.projectSettingsLoadError = projectLoadError;
		this.errors = [...initialErrors];
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
	}

	/** Create a SettingsManager that loads from files */
	static create(
		cwd: string,
		agentDir: string = getAgentDir(),
		options: SettingsManagerCreateOptions = {},
	): SettingsManager {
		const storage = new FileSettingsStorage(cwd, agentDir);
		return SettingsManager.fromStorage(storage, options);
	}

	/** Create a SettingsManager from an arbitrary storage backend */
	static fromStorage(storage: SettingsStorage, options: SettingsManagerCreateOptions = {}): SettingsManager {
		const projectTrusted = options.projectTrusted ?? true;
		const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
		const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
		const initialErrors: SettingsError[] = [];
		if (globalLoad.error) {
			initialErrors.push({ scope: "global", error: globalLoad.error });
		}
		if (projectLoad.error) {
			initialErrors.push({ scope: "project", error: projectLoad.error });
		}

		return new SettingsManager(
			storage,
			globalLoad.settings,
			projectLoad.settings,
			globalLoad.error,
			projectLoad.error,
			initialErrors,
			projectTrusted,
		);
	}

	/** Create an in-memory SettingsManager (no file I/O) */
	static inMemory(settings: Partial<Settings> = {}): SettingsManager {
		const storage = new InMemorySettingsStorage();
		const initialSettings = SettingsManager.migrateSettings(structuredClone(settings) as Record<string, unknown>);
		storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
		return SettingsManager.fromStorage(storage);
	}

	private static loadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): Settings {
		if (scope === "project" && !projectTrusted) {
			return {};
		}

		let content: string | undefined;
		storage.withLock(scope, (current) => {
			content = current;
			return undefined;
		});

		if (!content) {
			return {};
		}
		const settings = JSON.parse(content);
		return SettingsManager.migrateSettings(settings);
	}

	private static tryLoadFromStorage(
		storage: SettingsStorage,
		scope: SettingsScope,
		projectTrusted = true,
	): { settings: Settings; error: Error | null } {
		try {
			return { settings: SettingsManager.loadFromStorage(storage, scope, projectTrusted), error: null };
		} catch (error) {
			return { settings: {}, error: error as Error };
		}
	}

	/** Migrate old settings format to new format */
	private static migrateSettings(settings: Record<string, unknown>): Settings {
		// Migrate queueMode -> steeringMode
		if ("queueMode" in settings && !("steeringMode" in settings)) {
			settings.steeringMode = settings.queueMode;
			delete settings.queueMode;
		}

		// Migrate legacy websockets boolean -> transport enum
		if (!("transport" in settings) && typeof settings.websockets === "boolean") {
			settings.transport = settings.websockets ? "websocket" : "sse";
			delete settings.websockets;
		}

		// Migrate old skills object format to new array format
		if (
			"skills" in settings &&
			typeof settings.skills === "object" &&
			settings.skills !== null &&
			!Array.isArray(settings.skills)
		) {
			const skillsSettings = settings.skills as {
				enableSkillCommands?: boolean;
				customDirectories?: unknown;
			};
			if (skillsSettings.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
				settings.enableSkillCommands = skillsSettings.enableSkillCommands;
			}
			if (Array.isArray(skillsSettings.customDirectories) && skillsSettings.customDirectories.length > 0) {
				settings.skills = skillsSettings.customDirectories;
			} else {
				delete settings.skills;
			}
		}

		// Migrate retry.maxDelayMs -> retry.provider.maxRetryDelayMs
		if (
			"retry" in settings &&
			typeof settings.retry === "object" &&
			settings.retry !== null &&
			!Array.isArray(settings.retry)
		) {
			const retrySettings = settings.retry as Record<string, unknown>;
			const providerSettings =
				typeof retrySettings.provider === "object" && retrySettings.provider !== null
					? (retrySettings.provider as Record<string, unknown>)
					: undefined;
			if (
				typeof retrySettings.maxDelayMs === "number" &&
				(providerSettings?.maxRetryDelayMs === undefined || providerSettings?.maxRetryDelayMs === null)
			) {
				retrySettings.provider = {
					...(providerSettings ?? {}),
					maxRetryDelayMs: retrySettings.maxDelayMs,
				};
			}
			delete retrySettings.maxDelayMs;
		}

		return settings as Settings;
	}

	getGlobalSettings(): Settings {
		return structuredClone(this.globalSettings);
	}

	getProjectSettings(): Settings {
		return structuredClone(this.projectSettings);
	}

	isProjectTrusted(): boolean {
		return this.projectTrusted;
	}

	setProjectTrusted(trusted: boolean): void {
		if (this.projectTrusted === trusted) {
			return;
		}

		this.projectTrusted = trusted;
		this.modifiedProjectFields.clear();
		this.modifiedProjectNestedFields.clear();

		if (!trusted) {
			this.projectSettings = {};
			this.projectSettingsLoadError = null;
			this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
			return;
		}

		const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", trusted);
		this.projectSettings = projectLoad.settings;
		this.projectSettingsLoadError = projectLoad.error;
		if (projectLoad.error) {
			this.recordError("project", projectLoad.error);
		}
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
	}

	async reload(): Promise<void> {
		await this.writeQueue;
		const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
		if (!globalLoad.error) {
			this.globalSettings = globalLoad.settings;
			this.globalSettingsLoadError = null;
		} else {
			this.globalSettingsLoadError = globalLoad.error;
			this.recordError("global", globalLoad.error);
		}

		this.modifiedFields.clear();
		this.modifiedNestedFields.clear();
		this.modifiedProjectFields.clear();
		this.modifiedProjectNestedFields.clear();

		const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", this.projectTrusted);
		if (!projectLoad.error) {
			this.projectSettings = projectLoad.settings;
			this.projectSettingsLoadError = null;
		} else {
			this.projectSettingsLoadError = projectLoad.error;
			this.recordError("project", projectLoad.error);
		}

		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
	}

	/** Apply additional overrides on top of current settings */
	applyOverrides(overrides: Partial<Settings>): void {
		this.settings = deepMergeSettings(this.settings, overrides);
	}

	/** Mark a global field as modified during this session */
	private markModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedFields.add(field);
		if (nestedKey) {
			if (!this.modifiedNestedFields.has(field)) {
				this.modifiedNestedFields.set(field, new Set());
			}
			this.modifiedNestedFields.get(field)!.add(nestedKey);
		}
	}

	/** Mark a project field as modified during this session */
	private markProjectModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedProjectFields.add(field);
		if (nestedKey) {
			if (!this.modifiedProjectNestedFields.has(field)) {
				this.modifiedProjectNestedFields.set(field, new Set());
			}
			this.modifiedProjectNestedFields.get(field)!.add(nestedKey);
		}
	}

	private assertProjectTrustedForWrite(): void {
		if (!this.projectTrusted) {
			throw new Error("Project is not trusted; refusing to write project settings");
		}
	}

	private recordError(scope: SettingsScope, error: unknown): void {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		this.errors.push({ scope, error: normalizedError });
	}

	private clearModifiedScope(scope: SettingsScope): void {
		if (scope === "global") {
			this.modifiedFields.clear();
			this.modifiedNestedFields.clear();
			return;
		}

		this.modifiedProjectFields.clear();
		this.modifiedProjectNestedFields.clear();
	}

	private enqueueWrite(scope: SettingsScope, task: () => void): void {
		this.writeQueue = this.writeQueue
			.then(() => {
				if (scope === "project") {
					this.assertProjectTrustedForWrite();
				}
				task();
				this.clearModifiedScope(scope);
			})
			.catch((error) => {
				this.recordError(scope, error);
			});
	}

	private cloneModifiedNestedFields(source: Map<keyof Settings, Set<string>>): Map<keyof Settings, Set<string>> {
		const snapshot = new Map<keyof Settings, Set<string>>();
		for (const [key, value] of source.entries()) {
			snapshot.set(key, new Set(value));
		}
		return snapshot;
	}

	private persistScopedSettings(
		scope: SettingsScope,
		snapshotSettings: Settings,
		modifiedFields: Set<keyof Settings>,
		modifiedNestedFields: Map<keyof Settings, Set<string>>,
	): void {
		this.storage.withLock(scope, (current) => {
			const currentFileSettings = current
				? SettingsManager.migrateSettings(JSON.parse(current) as Record<string, unknown>)
				: {};
			const mergedSettings: Settings = { ...currentFileSettings };
			for (const field of modifiedFields) {
				const value = snapshotSettings[field];
				if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
					const nestedModified = modifiedNestedFields.get(field)!;
					const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
					const inMemoryNested = value as Record<string, unknown>;
					const mergedNested = { ...baseNested };
					for (const nestedKey of nestedModified) {
						mergedNested[nestedKey] = inMemoryNested[nestedKey];
					}
					(mergedSettings as Record<string, unknown>)[field] = mergedNested;
				} else {
					(mergedSettings as Record<string, unknown>)[field] = value;
				}
			}

			return JSON.stringify(mergedSettings, null, 2);
		});
	}

	private save(): void {
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

		if (this.globalSettingsLoadError) {
			return;
		}

		const snapshotGlobalSettings = structuredClone(this.globalSettings);
		const modifiedFields = new Set(this.modifiedFields);
		const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);

		this.enqueueWrite("global", () => {
			this.persistScopedSettings("global", snapshotGlobalSettings, modifiedFields, modifiedNestedFields);
		});
	}

	private saveProjectSettings(settings: Settings): void {
		this.assertProjectTrustedForWrite();
		this.projectSettings = structuredClone(settings);
		this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

		if (this.projectSettingsLoadError) {
			return;
		}

		const snapshotProjectSettings = structuredClone(this.projectSettings);
		const modifiedFields = new Set(this.modifiedProjectFields);
		const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
		this.enqueueWrite("project", () => {
			this.persistScopedSettings("project", snapshotProjectSettings, modifiedFields, modifiedNestedFields);
		});
	}

	private updateProjectSettings(field: keyof Settings, update: (settings: Settings) => void): void {
		this.assertProjectTrustedForWrite();
		const projectSettings = structuredClone(this.projectSettings);
		update(projectSettings);
		this.markProjectModified(field);
		this.saveProjectSettings(projectSettings);
	}

	async flush(): Promise<void> {
		await this.writeQueue;
	}

	drainErrors(): SettingsError[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	getLastChangelogVersion(): string | undefined {
		return this.settings.lastChangelogVersion;
	}

	setLastChangelogVersion(version: string): void {
		this.globalSettings.lastChangelogVersion = version;
		this.markModified("lastChangelogVersion");
		this.save();
	}

	getSessionDir(): string | undefined {
		const sessionDir = this.settings.sessionDir;
		return sessionDir ? normalizePath(sessionDir) : sessionDir;
	}

	getDefaultProvider(): string | undefined {
		return this.settings.defaultProvider;
	}

	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	getServiceModelSelection(): {
		provider?: string;
		modelId?: string;
		thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	} {
		return {
			provider: this.settings.serviceProvider,
			modelId: this.settings.serviceModel,
			thinkingLevel: this.settings.serviceThinkingLevel,
		};
	}

	getFastResponderSettings(): {
		enabled: boolean;
		provider?: string;
		modelId?: string;
		thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
		minContextTokens: number;
		timeoutMs: number;
		maxTokens: number;
	} {
		const responder = this.settings.fastResponder;
		const service = this.getServiceModelSelection();
		const modelId = responder?.model ?? service.modelId;
		const provider = responder?.provider ?? service.provider;
		const minContextTokens = parsePositiveIntegerSetting(
			responder?.minContextTokens,
			"fastResponder.minContextTokens",
		);
		const timeoutMs = parsePositiveIntegerSetting(responder?.timeoutMs, "fastResponder.timeoutMs");
		const maxTokens = parsePositiveIntegerSetting(responder?.maxTokens, "fastResponder.maxTokens");
		return {
			enabled: responder?.enabled ?? true,
			provider,
			modelId,
			thinkingLevel: responder?.thinkingLevel ?? service.thinkingLevel,
			minContextTokens: minContextTokens ?? 1000,
			timeoutMs: timeoutMs ?? 2000,
			maxTokens: maxTokens ?? 120,
		};
	}

	setDefaultProvider(provider: string): void {
		this.globalSettings.defaultProvider = provider;
		this.markModified("defaultProvider");
		this.save();
	}

	setDefaultModel(modelId: string): void {
		this.globalSettings.defaultModel = modelId;
		this.markModified("defaultModel");
		this.save();
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.globalSettings.defaultProvider = provider;
		this.globalSettings.defaultModel = modelId;
		this.markModified("defaultProvider");
		this.markModified("defaultModel");
		this.save();
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return this.settings.steeringMode || "one-at-a-time";
	}

	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.globalSettings.steeringMode = mode;
		this.markModified("steeringMode");
		this.save();
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return this.settings.followUpMode || "one-at-a-time";
	}

	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.globalSettings.followUpMode = mode;
		this.markModified("followUpMode");
		this.save();
	}

	getCompletionMode(): CompletionMode {
		const mode = this.settings.completionMode;
		if (typeof mode === "string" && mode in COMPLETION_MODE_ALIASES) {
			return COMPLETION_MODE_ALIASES[mode as keyof typeof COMPLETION_MODE_ALIASES];
		}
		return "explicit_finish";
	}

	getCompletionLimits(): CompletionProtocolLimits | undefined {
		const limits = this.settings.completionLimits;
		if (!limits) {
			return undefined;
		}
		const parsed: CompletionProtocolLimits = {};
		const maxTurns = parsePositiveIntegerSetting(limits.maxTurns, "completionLimits.maxTurns");
		const maxNoProgressTurns = parsePositiveIntegerSetting(
			limits.maxNoProgressTurns,
			"completionLimits.maxNoProgressTurns",
		);
		const maxMalformedToolRetries = parsePositiveIntegerSetting(
			limits.maxMalformedToolRetries,
			"completionLimits.maxMalformedToolRetries",
		);
		const maxEmptyAssistantRetries = parsePositiveIntegerSetting(
			limits.maxEmptyAssistantRetries,
			"completionLimits.maxEmptyAssistantRetries",
		);
		const maxMissingFinishRetries = parsePositiveIntegerSetting(
			limits.maxMissingFinishRetries,
			"completionLimits.maxMissingFinishRetries",
		);
		if (maxTurns !== undefined) parsed.maxTurns = maxTurns;
		if (maxNoProgressTurns !== undefined) parsed.maxNoProgressTurns = maxNoProgressTurns;
		if (maxMalformedToolRetries !== undefined) parsed.maxMalformedToolRetries = maxMalformedToolRetries;
		if (maxEmptyAssistantRetries !== undefined) parsed.maxEmptyAssistantRetries = maxEmptyAssistantRetries;
		if (maxMissingFinishRetries !== undefined) parsed.maxMissingFinishRetries = maxMissingFinishRetries;
		return Object.keys(parsed).length > 0 ? parsed : undefined;
	}

	getTheme(): string | undefined {
		return this.settings.theme;
	}

	setTheme(theme: string): void {
		this.globalSettings.theme = theme;
		this.markModified("theme");
		this.save();
	}

	getDefaultThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
		return this.settings.defaultThinkingLevel;
	}

	setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): void {
		this.globalSettings.defaultThinkingLevel = level;
		this.markModified("defaultThinkingLevel");
		this.save();
	}

	getTransport(): TransportSetting {
		return this.settings.transport ?? "auto";
	}

	setTransport(transport: TransportSetting): void {
		this.globalSettings.transport = transport;
		this.markModified("transport");
		this.save();
	}

	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? DEFAULT_COMPACTION_SETTINGS.enabled;
	}

	isToolResultContextExtractionEnabled(): boolean {
		return this.settings.enableToolResultContextExtraction ?? false;
	}

	setToolResultContextExtractionEnabled(enabled: boolean): void {
		this.globalSettings.enableToolResultContextExtraction = enabled;
		this.markModified("enableToolResultContextExtraction", String(enabled));
	}

	setCompactionEnabled(enabled: boolean): void {
		if (!this.globalSettings.compaction) {
			this.globalSettings.compaction = {};
		}
		this.globalSettings.compaction.enabled = enabled;
		this.markModified("compaction", "enabled");
		this.save();
	}

	getCompactionReserveTokens(): number {
		return this.getCompactionTriggerReserveTokens();
	}

	getCompactionKeepRecentTokens(): number {
		return this.getCompactionKeepRecentMaxTokens();
	}

	getCompactionTargetContextTokens(): number {
		return this.settings.compaction?.targetContextTokens ?? DEFAULT_COMPACTION_SETTINGS.targetContextTokens;
	}

	getCompactionTriggerReserveTokens(): number {
		return (
			this.settings.compaction?.triggerReserveTokens ??
			this.settings.compaction?.reserveTokens ??
			DEFAULT_COMPACTION_SETTINGS.triggerReserveTokens
		);
	}

	getCompactionTriggerRatio(): number | undefined {
		if (this.settings.compaction?.triggerRatio !== undefined) {
			return this.settings.compaction.triggerRatio;
		}
		if (
			this.settings.compaction?.triggerReserveTokens === undefined &&
			this.settings.compaction?.reserveTokens !== undefined
		) {
			return undefined;
		}
		return DEFAULT_COMPACTION_SETTINGS.triggerRatio;
	}

	getCompactionKeepRecentMinTokens(): number {
		return (
			this.settings.compaction?.keepRecentMinTokens ??
			this.settings.compaction?.keepRecentTokens ??
			DEFAULT_COMPACTION_SETTINGS.keepRecentMinTokens
		);
	}

	getCompactionKeepRecentMaxTokens(): number {
		return (
			this.settings.compaction?.keepRecentMaxTokens ??
			this.settings.compaction?.keepRecentTokens ??
			DEFAULT_COMPACTION_SETTINGS.keepRecentMaxTokens
		);
	}

	getCompactionSummaryMaxTokens(): number {
		return this.settings.compaction?.summaryMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.summaryMaxTokens;
	}

	getCompactionRenderedStateMaxTokens(): number {
		return this.settings.compaction?.renderedStateMaxTokens ?? DEFAULT_COMPACTION_SETTINGS.renderedStateMaxTokens;
	}

	getCompactionSettings(): {
		enabled: boolean;
		triggerReserveTokens: number;
		triggerRatio?: number;
		keepRecentMinTokens: number;
		keepRecentMaxTokens: number;
		summaryMaxTokens: number;
		renderedStateMaxTokens: number;
		targetContextTokens: number;
	} {
		return {
			enabled: this.getCompactionEnabled(),
			triggerReserveTokens: this.getCompactionTriggerReserveTokens(),
			triggerRatio: this.getCompactionTriggerRatio(),
			keepRecentMinTokens: this.getCompactionKeepRecentMinTokens(),
			keepRecentMaxTokens: this.getCompactionKeepRecentMaxTokens(),
			summaryMaxTokens: this.getCompactionSummaryMaxTokens(),
			renderedStateMaxTokens: this.getCompactionRenderedStateMaxTokens(),
			targetContextTokens: this.getCompactionTargetContextTokens(),
		};
	}

	getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
		return {
			reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384,
			skipPrompt: this.settings.branchSummary?.skipPrompt ?? false,
		};
	}

	getBranchSummarySkipPrompt(): boolean {
		return this.settings.branchSummary?.skipPrompt ?? false;
	}

	getRetryEnabled(): boolean {
		return this.settings.retry?.enabled ?? true;
	}

	setRetryEnabled(enabled: boolean): void {
		if (!this.globalSettings.retry) {
			this.globalSettings.retry = {};
		}
		this.globalSettings.retry.enabled = enabled;
		this.markModified("retry", "enabled");
		this.save();
	}

	getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } {
		return {
			enabled: this.getRetryEnabled(),
			maxRetries: this.settings.retry?.maxRetries ?? 3,
			baseDelayMs: this.settings.retry?.baseDelayMs ?? DEFAULT_AGENT_RETRY_BASE_DELAY_MS,
		};
	}

	getHttpIdleTimeoutMs(): number {
		return parseTimeoutSetting(this.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS;
	}

	setHttpIdleTimeoutMs(timeoutMs: number): void {
		if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
			throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`);
		}
		this.globalSettings.httpIdleTimeoutMs = Math.floor(timeoutMs);
		this.markModified("httpIdleTimeoutMs");
		this.save();
	}

	getProviderRetrySettings(): { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs: number } {
		return {
			timeoutMs: this.settings.retry?.provider?.timeoutMs,
			maxRetries: this.settings.retry?.provider?.maxRetries,
			maxRetryDelayMs: this.settings.retry?.provider?.maxRetryDelayMs ?? 60000,
		};
	}

	getWebSocketConnectTimeoutMs(): number | undefined {
		return parseTimeoutSetting(this.settings.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
	}

	getHideThinkingBlock(): boolean {
		return this.settings.hideThinkingBlock ?? false;
	}

	setHideThinkingBlock(hide: boolean): void {
		this.globalSettings.hideThinkingBlock = hide;
		this.markModified("hideThinkingBlock");
		this.save();
	}

	getShellPath(): string | undefined {
		return this.settings.shellPath;
	}

	setShellPath(path: string | undefined): void {
		this.globalSettings.shellPath = path;
		this.markModified("shellPath");
		this.save();
	}

	getQuietStartup(): boolean {
		return this.settings.quietStartup ?? false;
	}

	setQuietStartup(quiet: boolean): void {
		this.globalSettings.quietStartup = quiet;
		this.markModified("quietStartup");
		this.save();
	}

	getDefaultProjectTrust(): DefaultProjectTrust {
		const value = this.globalSettings.defaultProjectTrust;
		return value === "always" || value === "never" ? value : "ask";
	}

	setDefaultProjectTrust(defaultProjectTrust: DefaultProjectTrust): void {
		this.globalSettings.defaultProjectTrust = defaultProjectTrust;
		this.markModified("defaultProjectTrust");
		this.save();
	}

	getShellCommandPrefix(): string | undefined {
		return this.settings.shellCommandPrefix;
	}

	setShellCommandPrefix(prefix: string | undefined): void {
		this.globalSettings.shellCommandPrefix = prefix;
		this.markModified("shellCommandPrefix");
		this.save();
	}

	getNpmCommand(): string[] | undefined {
		return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined;
	}

	setNpmCommand(command: string[] | undefined): void {
		this.globalSettings.npmCommand = command ? [...command] : undefined;
		this.markModified("npmCommand");
		this.save();
	}

	getCollapseChangelog(): boolean {
		return this.settings.collapseChangelog ?? false;
	}

	setCollapseChangelog(collapse: boolean): void {
		this.globalSettings.collapseChangelog = collapse;
		this.markModified("collapseChangelog");
		this.save();
	}

	getStartupNotices(): boolean {
		return this.settings.startupNotices ?? false;
	}

	setStartupNotices(enabled: boolean): void {
		this.globalSettings.startupNotices = enabled;
		this.markModified("startupNotices");
		this.save();
	}

	getEnableInstallTelemetry(): boolean {
		return this.settings.enableInstallTelemetry ?? true;
	}

	setEnableInstallTelemetry(enabled: boolean): void {
		this.globalSettings.enableInstallTelemetry = enabled;
		this.markModified("enableInstallTelemetry");
		this.save();
	}

	getEnableAnalytics(): boolean {
		return this.settings.enableAnalytics ?? false;
	}

	getTrackingId(): string | undefined {
		return this.settings.trackingId;
	}

	/** Set the analytics opt-in preference; generates a tracking identifier on first opt-in */
	setEnableAnalytics(enabled: boolean): void {
		this.globalSettings.enableAnalytics = enabled;
		this.markModified("enableAnalytics");
		if (enabled && !this.globalSettings.trackingId) {
			this.globalSettings.trackingId = randomUUID();
			this.markModified("trackingId");
		}
		this.save();
	}

	getPackages(): PackageSource[] {
		return [...(this.settings.packages ?? [])];
	}

	setPackages(packages: PackageSource[]): void {
		this.globalSettings.packages = packages;
		this.markModified("packages");
		this.save();
	}

	setProjectPackages(packages: PackageSource[]): void {
		this.updateProjectSettings("packages", (settings) => {
			settings.packages = packages;
		});
	}

	getExtensionPaths(): string[] {
		return [...(this.settings.extensions ?? [])];
	}

	setExtensionPaths(paths: string[]): void {
		this.globalSettings.extensions = paths;
		this.markModified("extensions");
		this.save();
	}

	setProjectExtensionPaths(paths: string[]): void {
		this.updateProjectSettings("extensions", (settings) => {
			settings.extensions = paths;
		});
	}

	getSkillPaths(): string[] {
		return [...(this.settings.skills ?? [])];
	}

	setSkillPaths(paths: string[]): void {
		this.globalSettings.skills = paths;
		this.markModified("skills");
		this.save();
	}

	setProjectSkillPaths(paths: string[]): void {
		this.updateProjectSettings("skills", (settings) => {
			settings.skills = paths;
		});
	}

	getPromptTemplatePaths(): string[] {
		return [...(this.settings.prompts ?? [])];
	}

	setPromptTemplatePaths(paths: string[]): void {
		this.globalSettings.prompts = paths;
		this.markModified("prompts");
		this.save();
	}

	setProjectPromptTemplatePaths(paths: string[]): void {
		this.updateProjectSettings("prompts", (settings) => {
			settings.prompts = paths;
		});
	}

	getThemePaths(): string[] {
		return [...(this.settings.themes ?? [])];
	}

	setThemePaths(paths: string[]): void {
		this.globalSettings.themes = paths;
		this.markModified("themes");
		this.save();
	}

	setProjectThemePaths(paths: string[]): void {
		this.updateProjectSettings("themes", (settings) => {
			settings.themes = paths;
		});
	}

	getEnableSkillCommands(): boolean {
		return this.settings.enableSkillCommands ?? true;
	}

	setEnableSkillCommands(enabled: boolean): void {
		this.globalSettings.enableSkillCommands = enabled;
		this.markModified("enableSkillCommands");
		this.save();
	}

	getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
		return this.settings.thinkingBudgets;
	}

	getShowImages(): boolean {
		return this.settings.terminal?.showImages ?? true;
	}

	setShowImages(show: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showImages = show;
		this.markModified("terminal", "showImages");
		this.save();
	}

	getImageWidthCells(): number {
		const width = this.settings.terminal?.imageWidthCells;
		if (typeof width !== "number" || !Number.isFinite(width)) {
			return 60;
		}
		return Math.max(1, Math.floor(width));
	}

	setImageWidthCells(width: number): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.imageWidthCells = Math.max(1, Math.floor(width));
		this.markModified("terminal", "imageWidthCells");
		this.save();
	}

	getClearOnShrink(): boolean {
		// Settings takes precedence, then env var, then default false
		if (this.settings.terminal?.clearOnShrink !== undefined) {
			return this.settings.terminal.clearOnShrink;
		}
		return process.env.PI_CLEAR_ON_SHRINK === "1";
	}

	setClearOnShrink(enabled: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.clearOnShrink = enabled;
		this.markModified("terminal", "clearOnShrink");
		this.save();
	}

	getShowTerminalProgress(): boolean {
		return this.settings.terminal?.showTerminalProgress ?? false;
	}

	setShowTerminalProgress(enabled: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showTerminalProgress = enabled;
		this.markModified("terminal", "showTerminalProgress");
		this.save();
	}

	getShowTokenProgress(): boolean {
		return this.settings.terminal?.showTokenProgress ?? true;
	}

	setShowTokenProgress(enabled: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showTokenProgress = enabled;
		this.markModified("terminal", "showTokenProgress");
		this.save();
	}

	getShowTokenStats(): boolean {
		return this.settings.terminal?.showTokenStats ?? true;
	}

	setShowTokenStats(enabled: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showTokenStats = enabled;
		this.markModified("terminal", "showTokenStats");
		this.save();
	}

	getShowVersion(): boolean {
		return this.settings.terminal?.showVersion ?? false;
	}

	setShowVersion(enabled: boolean): void {
		if (!this.globalSettings.terminal) {
			this.globalSettings.terminal = {};
		}
		this.globalSettings.terminal.showVersion = enabled;
		this.markModified("terminal", "showVersion");
		this.save();
	}

	getImageAutoResize(): boolean {
		return this.settings.images?.autoResize ?? true;
	}

	setImageAutoResize(enabled: boolean): void {
		if (!this.globalSettings.images) {
			this.globalSettings.images = {};
		}
		this.globalSettings.images.autoResize = enabled;
		this.markModified("images", "autoResize");
		this.save();
	}

	getBlockImages(): boolean {
		return this.settings.images?.blockImages ?? false;
	}

	setBlockImages(blocked: boolean): void {
		if (!this.globalSettings.images) {
			this.globalSettings.images = {};
		}
		this.globalSettings.images.blockImages = blocked;
		this.markModified("images", "blockImages");
		this.save();
	}

	getEnabledModels(): string[] | undefined {
		return this.settings.enabledModels;
	}

	setEnabledModels(patterns: string[] | undefined): void {
		this.globalSettings.enabledModels = patterns;
		this.markModified("enabledModels");
		this.save();
	}

	getDoubleEscapeAction(): "fork" | "tree" | "none" {
		return this.settings.doubleEscapeAction ?? "tree";
	}

	setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
		this.globalSettings.doubleEscapeAction = action;
		this.markModified("doubleEscapeAction");
		this.save();
	}

	getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
		const mode = this.settings.treeFilterMode;
		const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
		return mode && valid.includes(mode) ? mode : "default";
	}

	setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void {
		this.globalSettings.treeFilterMode = mode;
		this.markModified("treeFilterMode");
		this.save();
	}

	getShowHardwareCursor(): boolean {
		return this.settings.showHardwareCursor ?? process.env.PI_HARDWARE_CURSOR === "1";
	}

	setShowHardwareCursor(enabled: boolean): void {
		this.globalSettings.showHardwareCursor = enabled;
		this.markModified("showHardwareCursor");
		this.save();
	}

	getEditorPaddingX(): number {
		return this.settings.editorPaddingX ?? 0;
	}

	setEditorPaddingX(padding: number): void {
		this.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding)));
		this.markModified("editorPaddingX");
		this.save();
	}

	getAutocompleteMaxVisible(): number {
		return this.settings.autocompleteMaxVisible ?? 5;
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible)));
		this.markModified("autocompleteMaxVisible");
		this.save();
	}

	getCodeBlockIndent(): string {
		return this.settings.markdown?.codeBlockIndent ?? "  ";
	}

	getWarnings(): WarningSettings {
		return { ...(this.settings.warnings ?? {}) };
	}

	setWarnings(warnings: WarningSettings): void {
		this.globalSettings.warnings = { ...warnings };
		this.markModified("warnings");
		this.save();
	}
}
