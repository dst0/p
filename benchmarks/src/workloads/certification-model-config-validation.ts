import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { certifiedResourcePolicy } from "./certification-resource-policy.ts";

interface ModelProjection {
  resolvedBackendModel: string;
  endpointSha256: string;
  requestApi: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
  toolUse: boolean;
  inputModalities: string[];
  outputModalities: string[];
  generation: Record<string, boolean | number | string>;
}

interface ModelReference {
  provider: string;
  id: string;
}

export interface ValidatedCertifiedModelConfiguration {
  sha256: string;
  modelsSha256: string;
  kiloSha256: string;
}

const generationKeys = ["temperature", "topP", "top_p", "topK", "top_k", "minP", "min_p", "seed"] as const;

export function validateCertifiedModelConfiguration(inputs: {
  modelsFile: string;
  kiloConfig: string;
  model: string;
  kiloModel: string;
  expectedResolvedModel: string;
}): ValidatedCertifiedModelConfiguration {
  const pReference = parseModelReference(inputs.model, "P");
  const kiloReference = parseModelReference(inputs.kiloModel, "Kilo");
  const resolvedReference = parseModelReference(inputs.expectedResolvedModel, "resolved backend");
  if (inputs.model !== inputs.expectedResolvedModel || pReference.id !== resolvedReference.id) {
    throw new Error("Certified P model selection does not match the expected resolved backend model");
  }
  if (kiloReference.id !== resolvedReference.id) {
    throw new Error("Certified Kilo model selection does not match the expected resolved backend model");
  }
  const pRaw = readCertifiedModelConfiguration(inputs.modelsFile, "P");
  const kiloRaw = readCertifiedModelConfiguration(inputs.kiloConfig, "Kilo");
  const p = pProjection(parseJson(pRaw, "P"), pReference, inputs.expectedResolvedModel);
  const kilo = kiloProjection(parseJsonc(kiloRaw), kiloReference, inputs.expectedResolvedModel);
  if (JSON.stringify(p) !== JSON.stringify(kilo)) {
    throw new Error("Certified model configuration parity mismatch between P and Kilo");
  }
  const modelsSha256 = hashText(pRaw);
  const kiloSha256 = hashText(kiloRaw);
  return {
    modelsSha256,
    kiloSha256,
    sha256: hashText(
      JSON.stringify({
        version: 2,
        modelsSha256,
        kiloSha256,
        projections: { pAndPi: p, kilo },
        resourcePolicy: certifiedResourcePolicy,
      }),
    ),
  };
}

export function readCertifiedModelConfiguration(path: string, label: "P" | "Kilo"): string {
  if (!existsSync(path)) throw new Error(`Certified ${label} model configuration is missing`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`Certified ${label} model configuration is unreadable`);
  }
}

function parseJson(raw: string, label: "P"): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(raw), `${label} model configuration is malformed`);
  } catch {
    throw new Error(`Certified ${label} model configuration is malformed`);
  }
}

function parseJsonc(raw: string): Record<string, unknown> {
  const parsed = ts.parseConfigFileTextToJson("kilo.jsonc", raw);
  if (parsed.error || parsed.config === undefined) throw new Error("Certified Kilo model configuration is malformed");
  return requireRecord(parsed.config, "Kilo model configuration is malformed");
}

function pProjection(
  document: Record<string, unknown>,
  reference: ModelReference,
  resolvedBackendModel: string,
): ModelProjection {
  const providers = requireRecord(document.providers, "P model configuration is incomplete");
  const provider = requireRecord(providers[reference.provider], "P selected provider is missing");
  const models = requireArray(provider.models, "P selected model is missing");
  const modelsWithId = models.filter(
    (value): value is Record<string, unknown> => isRecord(value) && value.id === reference.id,
  );
  if (modelsWithId.length !== 1) throw new Error("Certified P selected model must have exactly one configuration");
  const model = modelsWithId[0]!;
  return projection({
    resolvedBackendModel,
    endpointSha256: endpointSha256(model.baseUrl ?? provider.baseUrl, "P selected endpoint is missing"),
    requestApi: requireString(model.api ?? provider.api, "P request API is missing"),
    contextWindow: requirePositiveNumber(model.contextWindow, "P context window is missing"),
    maxOutputTokens: requirePositiveNumber(model.maxTokens, "P output limit is missing"),
    reasoning: optionalBoolean(model.reasoning, false, "P reasoning capability is invalid"),
    toolUse: true,
    inputModalities: optionalModalities(model.input, ["text"], "P input modalities are invalid"),
    outputModalities: ["text"],
    generation: readGeneration(model),
  });
}

function kiloProjection(
  document: Record<string, unknown>,
  reference: ModelReference,
  resolvedBackendModel: string,
): ModelProjection {
  const providers = requireRecord(document.provider, "Kilo model configuration is incomplete");
  const provider = requireRecord(providers[reference.provider], "Kilo selected provider is missing");
  const providerOptions = requireRecord(provider.options, "Kilo selected endpoint is missing");
  const models = requireRecord(provider.models, "Kilo selected model is missing");
  const model = requireRecord(models[reference.id], "Kilo selected model is missing");
  const limit = requireRecord(model.limit, "Kilo model limits are missing");
  const modalities = isRecord(model.modalities) ? model.modalities : undefined;
  return projection({
    resolvedBackendModel,
    endpointSha256: endpointSha256(providerOptions.baseURL, "Kilo selected endpoint is missing"),
    requestApi: apiForKiloAdapter(provider.npm),
    contextWindow: requirePositiveNumber(limit.context, "Kilo context window is missing"),
    maxOutputTokens: requirePositiveNumber(limit.output, "Kilo output limit is missing"),
    reasoning: optionalBoolean(model.reasoning, false, "Kilo reasoning capability is invalid"),
    toolUse: model.tool_call === true,
    inputModalities: optionalModalities(
      modalities?.input ?? model.input,
      ["text"],
      "Kilo input modalities are invalid",
    ),
    outputModalities: optionalModalities(
      modalities?.output ?? model.output,
      ["text"],
      "Kilo output modalities are invalid",
    ),
    generation: readGeneration(requireRecordOrEmpty(model.options, "Kilo generation options are invalid")),
  });
}

function projection(value: ModelProjection): ModelProjection {
  return {
    ...value,
    inputModalities: [...value.inputModalities].sort(),
    outputModalities: [...value.outputModalities].sort(),
    generation: Object.fromEntries(
      Object.entries(value.generation).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function readGeneration(record: Record<string, unknown>): Record<string, boolean | number | string> {
  const generation: Record<string, boolean | number | string> = {};
  for (const key of generationKeys) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Model generation parameters are invalid");
    generation[key] = value;
  }
  for (const key of ["reasoningEffort", "reasoning_effort"] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (!isThinkingLevel(value)) throw new Error("Model generation parameters are invalid");
    generation[key] = value;
  }
  return generation;
}

function apiForKiloAdapter(value: unknown): string {
  const adapter =
    value === undefined ? "@ai-sdk/openai-compatible" : requireString(value, "Kilo request API is invalid");
  const apis: Record<string, string> = {
    "@ai-sdk/openai-compatible": "openai-completions",
    "@ai-sdk/openai": "openai-responses",
    "@ai-sdk/anthropic": "anthropic-messages",
  };
  const api = apis[adapter];
  if (!api) throw new Error("Kilo request API is unsupported for certified parity");
  return api;
}

function endpointSha256(value: unknown, message: string): string {
  try {
    const endpoint = new URL(requireString(value, message));
    if (!endpoint.protocol || !endpoint.hostname) throw new Error(message);
    endpoint.username = "";
    endpoint.password = "";
    endpoint.search = "";
    endpoint.hash = "";
    endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "") || "/";
    return hashText(endpoint.toString());
  } catch {
    throw new Error(message);
  }
}

function parseModelReference(value: string, label: string): ModelReference {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1 || value.indexOf("/", separator + 1) !== -1) {
    throw new Error(`Certified ${label} model reference is invalid`);
  }
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function requireRecordOrEmpty(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined) return {};
  return requireRecord(value, message);
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}

function requirePositiveNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(message);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean, message: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function optionalModalities(value: unknown, fallback: string[], message: string): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => item !== "text" && item !== "image")) {
    throw new Error(message);
  }
  return [...new Set(value)];
}

function isThinkingLevel(value: unknown): value is "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
