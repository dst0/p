import type { AssistantMessage } from "@dst0/p-ai";
import type { AgentTool, AgentToolCall } from "../types.ts";
import {
  getStringValue,
  isRecord,
  normalizeMisplacedToolArguments,
  sanitizeToolCallIdSegment,
  stripMarkdownCodeFences,
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

export function createRecoveredToolCall(
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
    if (marker[0] === activeFence.marker[0]) {
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

export function extractMisplacedJsonToolCalls(text: string): ParsedMisplacedToolCall[] {
  const stripped = stripMarkdownCodeFences(text).trim();
  const calls = parseMisplacedToolCallJson(stripped);
  for (const block of collectMarkdownCodeFences(text)) {
    if (!isToolJsonFence(block.language)) continue;
    calls.push(...parseMisplacedToolCallJson(block.body.trim()));
  }
  return calls;
}

export function extractMisplacedToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AgentToolCall[] {
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
