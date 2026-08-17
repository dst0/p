import { describe, expect, it } from "vitest";
import {
  type SessionRecordingEvent,
  SessionStreamRecorder,
  SessionStreamReplayer,
} from "../src/core/session-recording/index.ts";

describe("Session Recording Crash Recovery & Multi-Turn", () => {
  it("preserves full rawArgs across multiple streaming tool chunks on mid-stream crash", () => {
    const events: SessionRecordingEvent[] = [];
    const recorder = new SessionStreamRecorder({ onEvent: (e) => events.push(e) });

    recorder.startTurn({ turnId: "turn_crash_chunks", turnIndex: 0 });
    recorder.recordDelta("str_c", "content", "Invoking tool now...");
    recorder.recordToolChunk("str_c", "call_streamed", 0, '{"path": "', "read_file");
    recorder.recordToolChunk("str_c", "call_streamed", 0, "src/core/", "read_file");
    recorder.recordToolChunk("str_c", "call_streamed", 0, 'engine.ts"}', "read_file");
    // Stream crashed before recordToolCall or endTurn

    const replayer = new SessionStreamReplayer();
    for (const e of events) replayer.feedEvent(e);
    const result = replayer.finalize();

    expect(result.isInterrupted).toBe(true);
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].status).toBe("interrupted");
    expect(result.turns[0].message?.toolCalls.length).toBe(1);
    expect(result.turns[0].message?.toolCalls[0].rawArgs).toBe('{"path": "src/core/engine.ts"}');
  });

  it("isolates events across recovered interrupted turns without event bleeding", () => {
    const events: SessionRecordingEvent[] = [];
    const recorder = new SessionStreamRecorder({ onEvent: (e) => events.push(e) });

    // Turn 1: Starts and emits delta, but crashes without endTurn
    recorder.startTurn({ turnId: "turn_1", turnIndex: 0 });
    recorder.recordDelta("s1", "content", "Halfway response in turn 1");

    // Turn 2: Fresh turn_start begins (reconnect / restart)
    recorder.startTurn({ turnId: "turn_2", turnIndex: 1 });
    recorder.recordDelta("s2", "content", "Fresh response in turn 2");
    recorder.endTurn({
      turnId: "turn_2",
      turnIndex: 1,
      status: "success",
      message: { role: "assistant", content: "Fresh response in turn 2" },
      rawUsage: { input_tokens: 100, output_tokens: 20 },
    });

    const replayer = new SessionStreamReplayer();
    for (const e of events) replayer.feedEvent(e);
    const result = replayer.finalize();

    expect(result.turns.length).toBe(2);
    // Turn 1 should have exactly 2 events (turn_start 1, delta 1)
    expect(result.turns[0].status).toBe("interrupted");
    expect(result.turns[0].events.length).toBe(2);
    expect(result.turns[0].events[0].type).toBe("turn_start");
    expect(
      (result.turns[0].events[0] as SessionRecordingEvent & { payload: { turn_id: string } }).payload.turn_id,
    ).toBe("turn_1");

    // Turn 2 should have exactly 3 events (turn_start 2, delta 2, turn_end 2)
    expect(result.turns[1].status).toBe("success");
    expect(result.turns[1].events.length).toBe(3);
    expect(result.turns[1].events[0].type).toBe("turn_start");
    expect(
      (result.turns[1].events[0] as SessionRecordingEvent & { payload: { turn_id: string } }).payload.turn_id,
    ).toBe("turn_2");
  });

  it("handles empty lines, malformed JSON, and unexpected objects gracefully", () => {
    const replayer = new SessionStreamReplayer();
    replayer.feedLine("");
    replayer.feedLine("   ");
    replayer.feedLine("this is not json { [");
    replayer.feedLine(JSON.stringify({ random_non_recording_object: 123 }));
    replayer.feedLine(
      JSON.stringify({
        v: 1,
        seq: 1,
        ts: Date.now(),
        type: "turn_start",
        payload: { turn_id: "t0", turn_index: 0, role: "assistant" },
      }),
    );
    replayer.feedLine(
      JSON.stringify({
        v: 1,
        seq: 2,
        ts: Date.now(),
        type: "delta",
        payload: { stream_id: "s0", chan: "content", data: "Hello world!" },
      }),
    );

    const result = replayer.finalize();
    expect(result.turns.length).toBe(1);
    expect(result.finalText).toBe("Hello world!");
  });
});
