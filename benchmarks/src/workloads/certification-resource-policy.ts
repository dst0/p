export const certifiedUnlimitedAgentSettings = {
  runBudget: { mode: "unlimited" },
} as const;

export const certifiedResourcePolicy = {
  schemaVersion: 1,
  agents: {
    p: { internalRunBudget: "unlimited" },
    pi: { internalRunBudget: "unlimited" },
    kilo: { internalRunBudget: "harness-only" },
  },
  taskDeadline: "shared",
  overallDeadline: "shared",
} as const;
