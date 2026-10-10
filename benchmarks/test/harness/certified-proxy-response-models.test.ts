import assert from "node:assert/strict";
import { test } from "node:test";
import { createCertifiedResponseModelCollector } from "../../src/harness/certified-proxy-response-models.ts";

const model = "resolved/model";
const event = `data: ${JSON.stringify({ model })}\n\n`;

test("collector reconstructs SSE records split across explicit buffer fragments", () => {
  const collector = createCertifiedResponseModelCollector("text/event-stream");
  const split = event.indexOf("model") + 2;
  collector.push(Buffer.from(event.slice(0, split)));
  collector.push(Buffer.from(event.slice(split)));
  assert.deepEqual(collector.finish(), [model]);
});

test("collector rejects a response missing the terminal SSE event delimiter", () => {
  const collector = createCertifiedResponseModelCollector("text/event-stream");
  collector.push(Buffer.from(event.slice(0, -1)));
  assert.deepEqual(collector.finish(), []);
});

test("collector rejects a truncated later event even after an earlier valid model", () => {
  const collector = createCertifiedResponseModelCollector("text/event-stream");
  collector.push(Buffer.from(`${event}data: {"model":"wrong"`));
  assert.deepEqual(collector.finish(), []);
});

test("collector bounds a completed oversized SSE data line", () => {
  const collector = createCertifiedResponseModelCollector("text/event-stream");
  assert.throws(() => collector.push(Buffer.from(`data: ${"x".repeat(1024 * 1024 + 1)}\n\n`)), /limit/u);
});

test("collector bounds the number of small model-bearing SSE events", () => {
  const collector = createCertifiedResponseModelCollector("text/event-stream");
  assert.throws(() => collector.push(Buffer.from(event.repeat(65_537))), /limit/u);
});
