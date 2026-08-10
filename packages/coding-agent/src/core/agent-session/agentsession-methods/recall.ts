import { existsSync, readFileSync } from "node:fs";
import { resolvePath } from "../../../utils/paths.ts";
import { readSubagentDigests } from "../../subagents.ts";
import type { AgentSession } from "../agentsession.ts";
import { getMessageTextForRecall, normalizeCompactionDetails } from "../message-utils.ts";
import { addOriginalRequestRecallCandidates } from "../recall-candidates.ts";
import type { RecallCandidate } from "../state-types.ts";

export function do__collectRecallCandidates(self: AgentSession): RecallCandidate[] {
  const candidates: RecallCandidate[] = [];
  const seenOriginalRequestIds = new Set<string>();
  addOriginalRequestRecallCandidates(
    candidates,
    self._getCurrentStructuredSessionState(self.sessionManager.getBranch()),
    seenOriginalRequestIds,
  );
  for (const digest of readSubagentDigests(self._cwd)) {
    const transcriptPath = digest.transcriptPath ? resolvePath(self._cwd, digest.transcriptPath) : undefined;
    const transcriptText =
      transcriptPath && existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : undefined;
    const rawText = transcriptText ?? JSON.stringify(digest, undefined, 2);
    candidates.push({
      pointer: {
        id: digest.id,
        kind: "artifact",
        summary: `Subagent ${digest.profile}: ${digest.summary}`,
        retrieveWhen: "Need read-only subagent digest evidence.",
      },
      searchText: `${digest.profile}\n${digest.query}\n${digest.summary}\n${digest.evidencePointers.join("\n")}\n${digest.transcriptPath ?? ""}`,
      rawText,
    });
  }
  for (const entry of self.sessionManager.getBranch()) {
    if (entry.type === "message") {
      const text = getMessageTextForRecall(entry.message);
      if (entry.message.role === "toolResult") {
        candidates.push({
          pointer: {
            id: `tool-result:${entry.message.toolCallId}`,
            kind: "tool_result",
            entryId: entry.id,
            summary: `${entry.message.toolName} ${entry.message.isError ? "error" : "success"} result`,
            retrieveWhen: `Need exact raw output from ${entry.message.toolName}.`,
          },
          searchText: text,
          rawText: text,
        });
      } else if (entry.message.role === "bashExecution") {
        candidates.push({
          pointer: {
            id: `bash:${entry.id}`,
            kind: "bash",
            entryId: entry.id,
            summary: `Bash command: ${entry.message.command}`,
            retrieveWhen: "Need exact bash command output.",
          },
          searchText: text,
          rawText: text,
        });
      } else {
        candidates.push({
          pointer: {
            id: `message:${entry.id}`,
            kind: "message",
            entryId: entry.id,
            summary: `${entry.message.role} message`,
            retrieveWhen: "Need exact old conversation message.",
          },
          searchText: text,
          rawText: text,
        });
      }
    } else if (entry.type === "compaction") {
      candidates.push({
        pointer: {
          id: `compaction:${entry.id}`,
          kind: "message",
          entryId: entry.id,
          summary: "Compaction checkpoint",
          retrieveWhen: "Need the rendered compaction checkpoint.",
        },
        searchText: entry.summary,
        rawText: entry.summary,
      });
      const details = normalizeCompactionDetails(entry.details);
      if (details.structuredState) {
        addOriginalRequestRecallCandidates(candidates, details.structuredState, seenOriginalRequestIds);
      }
      for (const pointer of details.structuredState?.evidence ?? []) {
        candidates.push({
          pointer,
          searchText: pointer.summary,
        });
      }
      if (details.markdownSummary) {
        candidates.push({
          pointer: {
            id: `compaction-markdown:${entry.id}`,
            kind: "message",
            entryId: entry.id,
            summary: "Raw markdown compaction summary",
            retrieveWhen: "Need pre-render markdown summary produced by the compaction model.",
          },
          searchText: details.markdownSummary,
          rawText: details.markdownSummary,
        });
      }
    }
  }
  return candidates;
}
