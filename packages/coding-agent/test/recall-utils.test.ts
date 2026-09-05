import { describe, expect, it } from "vitest";
import { scoreRecallCandidate } from "../src/core/agent-session/recall-utils.ts";
import type { RecallCandidate } from "../src/core/agent-session/state-types.ts";

function candidate(id: string, summary: string, searchText: string): RecallCandidate {
  return {
    pointer: {
      id,
      kind: "message",
      summary,
      retrieveWhen: "during recall tests",
    },
    searchText,
  };
}

describe("scoreRecallCandidate", () => {
  it("returns zero for a blank query", () => {
    expect(scoreRecallCandidate("  \n", candidate("message:1", "summary", "details"))).toBe(0);
  });

  it("normalizes the query before exact pointer matching", () => {
    expect(scoreRecallCandidate(" MESSAGE:1 ", candidate("message:1", "summary", "details"))).toBe(1);
  });

  it("gives a partial pointer match its higher relevance score", () => {
    expect(scoreRecallCandidate("message", candidate("message:1", "summary", "details"))).toBe(0.95);
  });

  it("counts matching normalized terms without changing their denominator", () => {
    const value = scoreRecallCandidate("  ALPHA beta GAMMA ", candidate("other", "Alpha summary", "contains gamma"));

    expect(value).toBe(2 / 3);
  });

  it("excludes one-character terms from the denominator", () => {
    expect(scoreRecallCandidate("alpha x", candidate("other", "summary", "contains alpha"))).toBe(1);
  });

  it("uses the full normalized query when all terms are one character", () => {
    expect(scoreRecallCandidate(" x ", candidate("other", "summary", "contains x"))).toBe(0.5);
    expect(scoreRecallCandidate(" x ", candidate("other", "summary", "details"))).toBe(0);
  });

  it("returns zero when no normalized term matches", () => {
    expect(scoreRecallCandidate("alpha beta", candidate("other", "summary", "details"))).toBe(0);
  });
});
