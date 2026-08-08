import { Agent, type AgentMessage } from "@dst0/p-agent-core";
import { formatNoModelSelectedMessage } from "../../auth-guidance.ts";
import type { EvidenceKind } from "../../compaction/index.ts";
import {
  BUILTIN_SUBAGENT_PROFILES,
  getSubagentAllowedTools,
  persistSubagentDigest,
  persistSubagentTranscript,
  type RunSubagentInput,
  type RunSubagentResult,
} from "../../subagents.ts";
import { createTurnCheckpointMessages } from "../../turn-checkpoint.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  capTextByTokens,
  estimateTextTokens,
  scoreRecallCandidate,
  summarizeSubagentTranscript,
} from "../recall-utils.ts";
import type { SessionRecallInput } from "../session-types.ts";
import type { RecallHit, RecallResult } from "../state-types.ts";

export async function do__runSubagent(self: AgentSession, input: RunSubagentInput): Promise<RunSubagentResult> {
  const profile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.name === input.profile);
  if (!profile) {
    throw new Error(`Unknown subagent profile: ${input.profile}`);
  }
  const model = self.model;
  if (!model) {
    throw new Error(formatNoModelSelectedMessage());
  }

  const allowedToolNames = getSubagentAllowedTools(input.profile);
  const tools = self.agent.state.tools.filter((tool) => allowedToolNames.has(tool.name));
  const systemPrompt = [
    `You are the ${input.profile} read-only subagent.`,
    profile.description,
    "Return a concise digest with findings, evidence pointers, and unresolved risks.",
    "Do not edit files. Do not run tools outside your allowed tool list.",
    "Do not continue the parent task; only answer the delegated subtask.",
  ].join("\n");
  const subagent = new Agent({
    initialState: {
      model,
      systemPrompt,
      tools,
    },
    convertToLlm: self.agent.convertToLlm,
    transformContext: async (messages, signal) => {
      const transformed = self.agent.transformContext ? await self.agent.transformContext(messages, signal) : messages;
      return self._preparePromptContext(transformed, systemPrompt).messages;
    },
    streamFn: self.agent.streamFn,
    getApiKey: self.agent.getApiKey,
    onPayload: self.agent.onPayload,
    onResponse: self.agent.onResponse,
    beforeToolCall: self.agent.beforeToolCall,
    afterToolCall: self.agent.afterToolCall,
    prepareNextTurn: (_signal, context) => ({
      appendMessages: context
        ? createTurnCheckpointMessages(
            context,
            self._getCurrentStructuredSessionState(),
            self.settingsManager.getCompactionRenderedStateMaxTokens(),
          )
        : undefined,
    }),
    toolExecution: "parallel",
    completionMode: "implicit",
    thinkingBudgets: self.agent.thinkingBudgets,
    transport: self.agent.transport,
    maxRetryDelayMs: self.agent.maxRetryDelayMs,
  });
  const transcript: AgentMessage[] = [];
  const unsubscribe = subagent.subscribe((event) => {
    if (event.type === "message_end") {
      transcript.push(event.message);
    }
  });
  try {
    await subagent.prompt(input.task);
  } finally {
    unsubscribe();
  }

  const summary = summarizeSubagentTranscript(transcript);
  const provisionalId = `subagent:${input.profile}:${Date.now().toString(36)}`;
  const transcriptPath = persistSubagentTranscript(self._cwd, provisionalId, transcript);
  const digest = persistSubagentDigest(self._cwd, {
    profile: input.profile,
    query: input.task,
    summary,
    evidencePointers: [`file:${transcriptPath}`],
    transcriptPath,
  });

  return {
    id: digest.id,
    profile: input.profile,
    task: input.task,
    summary: digest.summary,
    evidencePointers: digest.evidencePointers,
    turnCount: transcript.length,
  };
}

export function do__formatSubagentResult(_self: AgentSession, result: RunSubagentResult): string {
  const lines = [
    `[Subagent ${result.profile} completed]`,
    `ID: ${result.id}`,
    `Task: ${result.task}`,
    `Turns: ${result.turnCount}`,
    `Summary: ${result.summary}`,
  ];
  if (result.evidencePointers.length > 0) {
    lines.push(`Evidence: ${result.evidencePointers.join(", ")}`);
  }
  lines.push(`Retrieve: session_recall("${result.id}")`);
  return lines.join("\n");
}

export function do__recallSessionEvidence(self: AgentSession, params: SessionRecallInput): RecallResult {
  const defaultMaxTokens = params.includeRaw ? 4000 : 1200;
  const maxTokens = Math.max(1, Math.min(params.maxTokens ?? defaultMaxTokens, 4000));
  const kindFilter = params.kind ? new Set<EvidenceKind>(params.kind) : undefined;
  const scored = self
    ._collectRecallCandidates()
    .filter((candidate) => !kindFilter || kindFilter.has(candidate.pointer.kind))
    .map((candidate) => ({
      candidate,
      relevance: scoreRecallCandidate(params.query, candidate),
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.candidate.pointer.id.localeCompare(b.candidate.pointer.id));

  const hits: RecallHit[] = [];
  let remainingTokens = maxTokens;
  for (const item of scored.slice(0, 8)) {
    const rawText = params.includeRaw ? item.candidate.rawText : undefined;
    const rawTokens = rawText !== undefined ? estimateTextTokens(rawText) : undefined;
    const excerpt =
      rawText !== undefined && remainingTokens > 0 ? capTextByTokens(rawText, remainingTokens) : undefined;
    const excerptTokens = excerpt !== undefined ? estimateTextTokens(excerpt) : undefined;
    const truncated = rawTokens !== undefined ? rawTokens > remainingTokens : undefined;
    if (rawTokens !== undefined) {
      remainingTokens -= Math.min(rawTokens, remainingTokens);
    }
    hits.push({
      pointer: item.candidate.pointer,
      relevance: item.relevance,
      summary: item.candidate.pointer.summary,
      excerpt,
      rawTokens,
      excerptTokens,
      truncated,
    });
    if (remainingTokens <= 0) break;
  }
  return { query: params.query, hits };
}
