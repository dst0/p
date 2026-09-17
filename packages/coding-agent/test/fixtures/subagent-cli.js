const args = process.argv.slice(2);
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

process.stdout.write(
  `${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify(args) }],
      api: "test",
      provider: "test",
      model: "fixture-model",
      usage,
      stopReason: "stop",
      timestamp: Date.now(),
    },
  })}\n`,
);
