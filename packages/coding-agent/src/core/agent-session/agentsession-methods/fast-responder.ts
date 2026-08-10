import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import { completeSimple } from "@dst0/p-ai";
import { estimateContextTokens } from "../../compaction/index.ts";
import { type CustomMessage, FAST_RESPONDER_CUSTOM_TYPE } from "../../messages.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  FAST_RESPONDER_INPUT_TOKENS,
  TOOL_RESULT_EXTRACT_INPUT_TOKENS,
  TOOL_RESULT_EXTRACT_MIN_TOKENS,
  TOOL_RESULT_EXTRACT_OUTPUT_TOKENS,
} from "../constants.ts";
import { getMessageTextForRecall, isRecord } from "../message-utils.ts";
import {
  capTextByTokens,
  createDeterministicToolExtract,
  estimateTextTokens,
  getLatestUserText,
  getToolResultText,
  normalizeFastResponderText,
  parseToolExtractResponse,
} from "../recall-utils.ts";
import type { ToolResultContextExtract } from "../state-types.ts";

export async function do__createFastResponderMessage(
  self: AgentSession,
  userText: string,
  messages: AgentMessage[],
): Promise<CustomMessage<{ model: string; contextTokens: number }> | undefined> {
  if (!self._shouldRunFastResponder(messages)) {
    return undefined;
  }

  const request = self._getFastResponderModelRequest();
  if (!request) {
    return undefined;
  }

  const settings = self.settingsManager.getFastResponderSettings();
  const promptTokens = estimateContextTokens(messages, self.systemPrompt, { useProviderUsage: false }).tokens;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), settings.timeoutMs);
  try {
    const { apiKey, headers } = await self._getCompactionRequestAuth(request.model);
    const response = await completeSimple(
      request.model,
      {
        systemPrompt: [
          "You are P's fast local responder for a coding-agent session.",
          "Write one short user-visible update in the same language as the user's request.",
          "Restate the request concretely and say that work is starting.",
          "Do not claim that anything is already done. Do not mention hidden context, cache, or prefill.",
          "Use one or two concise sentences, no headings and no bullets.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              "User request:",
              capTextByTokens(userText, FAST_RESPONDER_INPUT_TOKENS),
              "",
              `Estimated main prompt size: ${promptTokens} tokens.`,
            ].join("\n"),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        headers,
        signal: timeoutController.signal,
        reasoning: request.thinkingLevel === "off" ? undefined : request.thinkingLevel,
        thinkingBudgets: self.agent.thinkingBudgets,
        maxRetryDelayMs: self.agent.maxRetryDelayMs,
        timeoutMs: settings.timeoutMs,
        maxTokens: settings.maxTokens,
      },
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return undefined;
    }
    const text = normalizeFastResponderText(getMessageTextForRecall(response));
    if (!text) {
      return undefined;
    }
    return {
      role: "custom",
      customType: FAST_RESPONDER_CUSTOM_TYPE,
      content: text,
      display: true,
      details: {
        model: `${request.model.provider}/${request.model.id}`,
        contextTokens: promptTokens,
      },
      timestamp: Date.now(),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function do__maybeCreateToolResultContextExtract(
  self: AgentSession,
  toolName: string,
  content: (TextContent | ImageContent)[],
  details: unknown,
  isError: boolean,
  contextMessages: AgentMessage[],
  signal?: AbortSignal,
): Promise<ToolResultContextExtract | undefined> {
  if (!self.settingsManager.isToolResultContextExtractionEnabled()) {
    return undefined;
  }

  if (isRecord(details) && isRecord(details.contextExtract)) {
    return undefined;
  }

  const text = getToolResultText(content).trim();
  if (!text) {
    return undefined;
  }

  const textTokens = estimateTextTokens(text);
  if (!isError && textTokens < TOOL_RESULT_EXTRACT_MIN_TOKENS) {
    return undefined;
  }

  const fallback = createDeterministicToolExtract(toolName, text, isError);
  const serviceRequest = self._getServiceModelRequest(
    TOOL_RESULT_EXTRACT_INPUT_TOKENS + TOOL_RESULT_EXTRACT_OUTPUT_TOKENS,
  );

  try {
    const authRequest = await self._getServiceAuthWithCurrentFallback(serviceRequest);
    const modelLabel = `${authRequest.model.provider}/${authRequest.model.id}`;
    const latestUserText = getLatestUserText(contextMessages);
    const output = capTextByTokens(text, TOOL_RESULT_EXTRACT_INPUT_TOKENS);
    const response = await completeSimple(
      authRequest.model,
      {
        systemPrompt: [
          "Extract a compact context note from one coding-agent tool result.",
          "The main agent will see only this note unless it explicitly recalls raw evidence.",
          "First line: one concise summary sentence.",
          "Then include up to 12 short evidence lines with exact file paths, commands, errors, counts, or decisions.",
          "Drop boilerplate, progress logs, duplicate lines, and unimportant long output.",
          "Do not invent facts and do not mention content that is not visible in the tool output.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              `Current user task hint: ${latestUserText || "(unknown)"}`,
              `Tool: ${toolName}`,
              `Status: ${isError ? "error" : "success"}`,
              "Tool output:",
              output,
            ].join("\n\n"),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: authRequest.apiKey,
        headers: authRequest.headers,
        signal,
        reasoning: authRequest.thinkingLevel === "off" ? undefined : authRequest.thinkingLevel,
        thinkingBudgets: self.agent.thinkingBudgets,
        maxRetryDelayMs: self.agent.maxRetryDelayMs,
        timeoutMs: 45_000,
      },
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      throw new Error(response.errorMessage ?? `tool-result extraction stopped with ${response.stopReason}`);
    }
    const responseText = getMessageTextForRecall(response).trim();
    return parseToolExtractResponse(responseText, modelLabel, fallback);
  } catch (err) {
    return {
      ...fallback,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
