import type { StructuredSessionState } from "../compaction/index.ts";
import type { RecallCandidate } from "./state-types.ts";

export function addOriginalRequestRecallCandidates(
  candidates: RecallCandidate[],
  state: StructuredSessionState,
  seenRequestIds: Set<string>,
): void {
  for (const request of state.canonicalRequest.originalRequests ?? []) {
    if (seenRequestIds.has(request.id)) continue;
    seenRequestIds.add(request.id);
    const kindLabel = request.kind === "follow_up" ? "follow-up" : request.kind;
    candidates.push({
      pointer: {
        id: request.id,
        kind: "message",
        entryId: request.entryId,
        summary: `User ${kindLabel}: ${request.summary}`,
        retrieveWhen: "Need the exact original user prompt preserved across compaction.",
      },
      searchText: [
        "all user prompts in this session",
        "original prompts prompt requests request user messages",
        request.kind,
        state.canonicalRequest.current,
        request.summary,
        request.text,
      ].join("\n"),
      rawText: request.text,
    });
  }
}
