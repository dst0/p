import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { resolveConfigValueUncached } from "../project-instructions/coding-agent-runtime-bindings.ts";
import type { RunnerOptions } from "../workloads/runner-options.ts";
import { projectCertifiedKiloConfig, projectCertifiedPConfig } from "./certified-proxy-config-projection.ts";

export interface CertifiedProxyConfig {
  upstreamBaseUrl: string;
  resolvedModel: string;
  expectedModel: string;
  apiKey?: string;
}

export type CertifiedProxyConfigOptions = Pick<RunnerOptions, "model" | "kiloModel" | "expectedResolvedModel">;
type JsonObject = Record<string, unknown>;

interface ParsedConfig {
  path: string;
  value: JsonObject;
}

type ProviderSelection = { providerId: string; modelId: string };

interface PAgentConfig {
  path: string;
  provider: JsonObject;
  model: JsonObject;
  selection: ProviderSelection;
  upstreamBaseUrl: string;
  apiKey?: string;
}

interface KiloAgentConfig {
  path: string;
  options: JsonObject;
  model: JsonObject;
  selection: ProviderSelection;
}

type LoadedConfigs = { p: PAgentConfig; pi: PAgentConfig; kilo: KiloAgentConfig; result: CertifiedProxyConfig };

function fail(message: string): never {
  throw new Error(message);
}

function readConfig(path: string): ParsedConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return fail("Certified agent configuration is missing or unreadable");
  }
  const parsedValue = ts.parseConfigFileTextToJson(path, text);
  if (parsedValue.error) return fail("Certified agent configuration is invalid");
  const value = objectValue(parsedValue.config);
  return { path, value };
}

function objectValue(value: unknown): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return fail("Certified agent configuration has an invalid object value");
}
function requiredString(value: unknown, message: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return fail(message);
}
function selectedModel(value: string | undefined, message: string): ProviderSelection {
  if (!value) return fail(message);
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return fail(message);
  return { providerId: value.slice(0, separator), modelId: value.slice(separator + 1) };
}
function normalizeUpstream(value: unknown): string {
  const raw = requiredString(value, "Certified upstream URL is missing");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("Certified upstream URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    return fail("Certified upstream URL must be HTTPS without credentials, query, or fragment");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.href;
}

function selectPAgentConfig(
  options: CertifiedProxyConfigOptions,
  dirs: Record<string, string>,
  agent: "p" | "pi",
): PAgentConfig {
  const selection = selectedModel(options.model, "Certified P/Pi model selection is missing or invalid");
  const parsed = readConfig(join(requiredString(dirs[agent], "Certified agent directory is missing"), "models.json"));
  const providers = objectValue(parsed.value.providers);
  const provider = objectValue(providers[selection.providerId]);
  if (provider.api !== "openai-completions") return fail("Certified P/Pi provider API is unsupported");
  const models = provider.models;
  if (!Array.isArray(models)) return fail("Certified P/Pi model list is missing");
  const matches = models.filter((item) => objectValue(item).id === selection.modelId);
  if (matches.length !== 1) return fail("Certified P/Pi selected model is missing or ambiguous");
  const model = objectValue(matches[0]);
  const resolvedModel = requiredString(model.id, "Certified P/Pi model id is missing");
  if (resolvedModel !== options.expectedResolvedModel)
    return fail("Certified P/Pi model does not match the expected resolved model");
  if (model.baseUrl !== undefined) return fail("Certified P/Pi model baseUrl override prevents proxy routing");
  const upstreamBaseUrl = normalizeUpstream(provider.baseUrl);
  const apiKeyValue = provider.apiKey;
  if (apiKeyValue !== undefined && typeof apiKeyValue !== "string") {
    return fail("Certified P/Pi API key configuration is invalid");
  }
  return {
    path: parsed.path,
    provider,
    model,
    selection,
    upstreamBaseUrl,
    ...(typeof apiKeyValue === "string" && apiKeyValue.length > 0 ? { apiKey: apiKeyValue } : {}),
  };
}

function selectKiloAgentConfig(options: CertifiedProxyConfigOptions, dirs: Record<string, string>): KiloAgentConfig {
  const selection = selectedModel(options.kiloModel, "Certified Kilo model selection is missing or invalid");
  const root = requiredString(dirs.kilo, "Certified Kilo directory is missing");
  const parsed = readConfig(join(root, "config", "kilo", "kilo.jsonc"));
  const providers = objectValue(parsed.value.provider);
  const provider = objectValue(providers[selection.providerId]);
  if (provider.npm !== "@ai-sdk/openai-compatible")
    return fail("Certified Kilo provider must use the OpenAI-compatible adapter");
  const optionsValue = objectValue(provider.options);
  let kiloProtocol: string;
  try {
    kiloProtocol = new URL(requiredString(optionsValue.baseURL, "Certified Kilo source URL is missing")).protocol;
  } catch {
    return fail("Certified Kilo source URL is invalid");
  }
  if (kiloProtocol !== "http:" && kiloProtocol !== "https:")
    return fail("Certified Kilo source URL protocol is unsupported");
  const models = objectValue(provider.models);
  if (models[selection.modelId] === undefined) return fail("Certified Kilo selected model is missing");
  const model = objectValue(models[selection.modelId]);
  return {
    path: parsed.path,
    options: optionsValue,
    model,
    selection,
  };
}

function loadConfigs(options: CertifiedProxyConfigOptions, dirs: Record<string, string>): LoadedConfigs {
  const expectedModel = requiredString(options.expectedResolvedModel, "Certified expected model is missing");
  const p = selectPAgentConfig(options, dirs, "p");
  const pi = selectPAgentConfig(options, dirs, "pi");
  const kilo = selectKiloAgentConfig(options, dirs);
  if (p.upstreamBaseUrl !== pi.upstreamBaseUrl) return fail("Certified P/Pi upstream URLs do not match");
  if (p.apiKey !== pi.apiKey) return fail("Certified P/Pi canonical API keys do not match");
  const projectedP = projectCertifiedPConfig(
    p.selection.providerId,
    p.provider,
    p.model,
    expectedModel,
    "http://localhost/",
  );
  const projectedPi = projectCertifiedPConfig(
    pi.selection.providerId,
    pi.provider,
    pi.model,
    expectedModel,
    "http://localhost/",
  );
  if (JSON.stringify(projectedP) !== JSON.stringify(projectedPi)) {
    return fail("Certified P/Pi selected generation metadata mismatch");
  }
  return {
    p,
    pi,
    kilo,
    result: {
      upstreamBaseUrl: p.upstreamBaseUrl,
      resolvedModel: expectedModel,
      expectedModel,
      ...(p.apiKey === undefined ? {} : { apiKey: p.apiKey }),
    },
  };
}

export function readCertifiedProxyConfig(
  options: CertifiedProxyConfigOptions,
  dirs: Record<string, string>,
): CertifiedProxyConfig {
  const result = loadConfigs(options, dirs).result;
  if (result.apiKey === undefined) return result;
  const apiKey = resolveConfigValueUncached(result.apiKey);
  if (!apiKey) return fail("Certified canonical API key could not be resolved");
  return { ...result, apiKey };
}

function normalizeProxyUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Certified proxy URL is invalid");
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return fail("Certified proxy URL must be a local HTTP endpoint");
  }
  return url.href;
}

export function rewriteCertifiedAgentConfigs(
  options: CertifiedProxyConfigOptions,
  dirs: Record<string, string>,
  proxyBaseUrl: string,
): void {
  const configs = loadConfigs(options, dirs);
  const proxyUrl = normalizeProxyUrl(proxyBaseUrl);
  const projectedPConfigs = (["p", "pi"] as const).map((agent) => {
    const config = configs[agent];
    return {
      path: config.path,
      value: projectCertifiedPConfig(
        config.selection.providerId,
        config.provider,
        config.model,
        configs.result.expectedModel,
        proxyUrl,
      ),
    };
  });
  const projectedKiloConfig = projectCertifiedKiloConfig(
    configs.kilo.selection.providerId,
    configs.kilo.selection.modelId,
    configs.kilo.options,
    configs.kilo.model,
    configs.result.expectedModel,
    proxyUrl,
  );
  for (const config of projectedPConfigs) writePrivateConfig(config.path, config.value);
  writePrivateConfig(configs.kilo.path, projectedKiloConfig);
}

function writePrivateConfig(path: string, value: JsonObject): void {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    const verified = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
    if (verified.error) throw new Error("Invalid generated config");
  } catch {
    throw new Error("Certified copied configuration could not be rewritten or verified");
  }
}
