export function modelAliasForAgent(agent, options) {
  if (agent === "codex") return options.codexModel;
  if (agent === "kilo") return options.kiloModel;
  if (agent === "agy") return options.agyModel;
  return options.model;
}

export function benchmarkModels(options) {
  return {
    pi: options.model,
    p: options.model,
    codex: options.agents.includes("codex") ? options.codexModel : undefined,
    kilo: options.agents.includes("kilo") ? options.kiloModel : undefined,
    agy: options.agents.includes("agy") ? options.agyModel : undefined,
  };
}
