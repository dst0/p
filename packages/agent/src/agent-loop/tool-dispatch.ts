import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentTool, AgentToolCall } from "../types.ts";
import {
  getStringValue,
  isClosingMarkdownFence,
  isFullyRecoverableMisplacedToolArguments,
  isRecord,
  normalizeMisplacedToolArguments,
  sanitizeToolCallIdSegment,
  serializeCanonicalMisplacedToolArguments,
  splitMarkdownFenceSegments,
} from "./message-preparation.ts";
import type { ParsedMisplacedToolCall } from "./types.ts";

export function collectMisplacedToolCallsFromJson(value: unknown): ParsedMisplacedToolCall[] {
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

export function parseMisplacedToolCallJson(block: string): ParsedMisplacedToolCall[] {
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

function containsOnlyKnownMisplacedToolCalls(value: unknown, toolNames: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => containsOnlyKnownMisplacedToolCalls(item, toolNames));
  }
  if (!isRecord(value)) return false;
  const toolListAliases = ["tool_calls", "toolCalls", "tools"] as const;
  const toolListAliasCount = countPresentKeys(value, toolListAliases);
  const nestedToolCalls = value.tool_calls ?? value.toolCalls ?? value.tools;
  if (toolListAliasCount > 0) {
    if (toolListAliasCount !== 1 || !Array.isArray(nestedToolCalls) || !hasOnlyKeys(value, toolListAliases)) {
      return false;
    }
    return (
      nestedToolCalls.length > 0 &&
      nestedToolCalls.every((item) => containsOnlyKnownMisplacedToolCalls(item, toolNames))
    );
  }
  const nestedFunction = value.function;
  if (isRecord(nestedFunction)) {
    if (!hasOnlyKeys(value, ["function", "type", "id", "arguments", "input"])) return false;
    if (!hasOnlyKeys(nestedFunction, ["name", "arguments", "input"])) return false;
    if (!hasValidOptionalMetadata(value, ["function"])) return false;
    const argumentCount =
      countPresentKeys(value, ["arguments", "input"]) + countPresentKeys(nestedFunction, ["arguments", "input"]);
    if (argumentCount > 1) return false;
    const argumentValue = nestedFunction.arguments ?? nestedFunction.input ?? value.arguments ?? value.input;
    if (argumentCount === 1 && !isLosslesslyNormalizableArgument(argumentValue)) return false;
    const name = getStringValue(nestedFunction.name);
    return name !== undefined && toolNames.has(name);
  }
  if (
    !hasOnlyKeys(value, [
      "name",
      "tool_name",
      "toolName",
      "tool",
      "function",
      "arguments",
      "input",
      "parameters",
      "params",
      "type",
      "id",
    ])
  ) {
    return false;
  }
  if (!hasValidOptionalMetadata(value, ["function", "tool_call", "tool-call", "toolCall", "tool_use"])) return false;
  if (countPresentKeys(value, ["name", "tool_name", "toolName", "tool", "function"]) !== 1) return false;
  const argumentCount = countPresentKeys(value, ["arguments", "input", "parameters", "params"]);
  if (argumentCount > 1) return false;
  const argumentValue = value.arguments ?? value.input ?? value.parameters ?? value.params;
  if (argumentCount === 1 && !isLosslesslyNormalizableArgument(argumentValue)) return false;
  const name = getStringValue(value.name ?? value.tool_name ?? value.toolName ?? value.tool ?? value.function);
  return name !== undefined && toolNames.has(name);
}

function countPresentKeys(value: Record<string, unknown>, keys: readonly string[]): number {
  return keys.filter((key) => Object.hasOwn(value, key)).length;
}
function hasValidOptionalMetadata(value: Record<string, unknown>, types: readonly string[]): boolean {
  if (Object.hasOwn(value, "id") && getStringValue(value.id) === undefined) return false;
  return !Object.hasOwn(value, "type") || (typeof value.type === "string" && types.includes(value.type));
}
function isLosslesslyNormalizableArgument(value: unknown): boolean {
  if (isRecord(value)) return true;
  if (typeof value !== "string") return false;
  try {
    return isRecord(JSON.parse(value) as unknown);
  } catch {
    return false;
  }
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
export function isFullyRecoverableMisplacedToolCallJson(block: string, toolNames: ReadonlySet<string>): boolean {
  if (toolNames.size === 0 || !block) return false;
  if (!(block.startsWith("{") && block.endsWith("}")) && !(block.startsWith("[") && block.endsWith("]"))) {
    return false;
  }
  try {
    return containsOnlyKnownMisplacedToolCalls(JSON.parse(block) as unknown, toolNames);
  } catch {
    return false;
  }
}

export function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)))
    .replace(/&#([0-9]+);/g, (_match, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 10)))
    .replaceAll("&amp;", "&");
}

export function parseMisplacedToolArguments(body: string): Record<string, unknown> {
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

export function parseMisplacedToolCallBlock(block: string): ParsedMisplacedToolCall[] {
  const trimmed = block.trim();
  const jsonCalls = parseMisplacedToolCallJson(trimmed);
  if (jsonCalls.length > 0) {
    const names = new Set(jsonCalls.map((call) => call.name));
    return isFullyRecoverableMisplacedToolCallJson(trimmed, names) ? jsonCalls : [];
  }
  const namedFunctionPattern = /<function(?:=([A-Za-z0-9_.:-]+)|\s+name=["']([^"']+)["'])\s*>([\s\S]*?)<\/function>/gi;
  const namedFunctions = [...block.matchAll(namedFunctionPattern)];
  if (namedFunctions.length > 0) {
    const fullyConsumed =
      block.replace(namedFunctionPattern, "").trim().length === 0 &&
      namedFunctions.every((match) => isFullyRecoverableMisplacedToolArguments(match[3] ?? ""));
    if (!fullyConsumed) return [];
    return namedFunctions.map((match) => ({
      name: (match[1] ?? match[2] ?? "").trim(),
      arguments: parseMisplacedToolArguments(match[3] ?? ""),
    }));
  }
  const bareFunctionPattern = /<function>\s*([A-Za-z0-9_.:-]+)\s*<\/function>/gi;
  const bareFunctions = [...block.matchAll(bareFunctionPattern)];
  if (bareFunctions.length !== 1) return [];
  const argumentBody = block.replace(bareFunctionPattern, "").trim();
  if (!isFullyRecoverableMisplacedToolArguments(argumentBody)) return [];
  return [{ name: bareFunctions[0][1].trim(), arguments: parseMisplacedToolArguments(argumentBody) }];
}

export function createRecoveredToolCall(
  parsed: ParsedMisplacedToolCall,
  toolNames: ReadonlySet<string>,
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

export function collectMarkdownCodeFences(value: string): Array<{ language: string; body: string }> {
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
    if (isClosingMarkdownFence(line, activeFence.marker)) {
      blocks.push({ language: activeFence.language.toLowerCase(), body: activeFence.lines.join("\n") });
      activeFence = undefined;
    } else {
      activeFence.lines.push(line);
    }
  }
  return blocks;
}

export function isToolJsonFence(language: string): boolean {
  if (!language) return false;
  return /^(json|jsonc|tool|tools|tool_call|tool-call|function|functions)$/i.test(language);
}
export function extractMisplacedJsonToolCalls(text: string, toolNames: ReadonlySet<string>): ParsedMisplacedToolCall[] {
  if (toolNames.size === 0) return [];
  const rawJson = text.trim();
  const calls = isFullyRecoverableMisplacedToolCallJson(rawJson, toolNames) ? parseMisplacedToolCallJson(rawJson) : [];
  for (const block of collectMarkdownCodeFences(text)) {
    const body = block.body.trim();
    if (!isToolJsonFence(block.language) || !isFullyRecoverableMisplacedToolCallJson(body, toolNames)) continue;
    calls.push(...parseMisplacedToolCallJson(body));
  }
  return calls.filter((call) => toolNames.has(call.name));
}

export function extractMisplacedToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AgentToolCall[] {
  const toolNames = new Set(tools?.map((tool) => tool.name) ?? []);
  const textBlocks = message.content.flatMap((block) => {
    if (block.type === "text") return [block.text];
    if (block.type === "thinking") return [block.thinking];
    return [];
  });
  const toolCalls: AgentToolCall[] = [];
  const blockMatches = textBlocks.flatMap((block) =>
    splitMarkdownFenceSegments(block).flatMap((segment) =>
      segment.fenced ? [] : [...segment.text.matchAll(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi)],
    ),
  );
  let index = 0;
  for (const blockMatch of blockMatches) {
    for (const parsed of parseMisplacedToolCallBlock(blockMatch[1])) {
      const toolCall = createRecoveredToolCall(parsed, toolNames, index);
      toolCalls.push(toolCall);
      index++;
    }
  }
  const markupCallKeys = toolCalls.map(
    (call) => `${call.name}:${serializeCanonicalMisplacedToolArguments(call.arguments)}`,
  );
  for (const parsed of textBlocks.flatMap((block) => extractMisplacedJsonToolCalls(block, toolNames))) {
    const argumentsKey =
      markupCallKeys.length > 0 ? serializeCanonicalMisplacedToolArguments(parsed.arguments) : undefined;
    const key = argumentsKey === undefined ? undefined : `${parsed.name}:${argumentsKey}`;
    const duplicateIndex = key === undefined ? -1 : markupCallKeys.indexOf(key);
    if (duplicateIndex >= 0) {
      markupCallKeys.splice(duplicateIndex, 1);
      continue;
    }
    const toolCall = createRecoveredToolCall(parsed, toolNames, index);
    toolCalls.push(toolCall);
    index++;
  }
  return toolCalls;
}
