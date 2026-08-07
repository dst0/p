import * as fs from "node:fs";
import type { Model } from "@dst0/p-ai";
import { APP_NAME } from "../../../config.ts";
import { defaultModelPerProvider } from "../../../core/model-resolver.ts";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "../../../core/provider-display-names.ts";
import type { SessionManager } from "../../../core/session-manager.ts";
import { BUILT_IN_MODEL_PROVIDERS, DEAD_TERMINAL_ERROR_CODES } from "./constants.ts";
import type { Expandable } from "./types.ts";

export function isExpandable(obj: unknown): obj is Expandable {
  return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

export function isDeadTerminalError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code);
}

export function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

export function isUnknownModel(model: Model<any> | undefined): boolean {
  return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

export function quoteIfNeeded(value: string): string {
  if (value.length > 0 && !/[^a-zA-Z0-9_\-./~:@]/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatResumeCommand(sessionManager: SessionManager): string | undefined {
  if (!process.stdout.isTTY) return undefined;
  if (!sessionManager.isPersisted()) return undefined;

  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile || !fs.existsSync(sessionFile)) return undefined;

  const args = [APP_NAME];
  if (!sessionManager.usesDefaultSessionDir()) {
    args.push("--session-dir", quoteIfNeeded(sessionManager.getSessionDir()));
  }
  args.push("--session", sessionManager.getSessionId());
  return args.join(" ");
}

export function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
  return providerId in defaultModelPerProvider;
}

export function isApiKeyLoginProvider(
  providerId: string,
  oauthProviderIds: ReadonlySet<string>,
  builtInProviderIds: ReadonlySet<string> = BUILT_IN_MODEL_PROVIDERS,
): boolean {
  if (BUILT_IN_PROVIDER_DISPLAY_NAMES[providerId]) {
    return true;
  }
  if (builtInProviderIds.has(providerId)) {
    return false;
  }
  return !oauthProviderIds.has(providerId);
}
