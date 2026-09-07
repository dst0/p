export interface BenchmarkModelOptions {
  agents: readonly string[];
  model?: string;
  codexModel?: string;
  kiloModel?: string;
  agyModel?: string;
}

export function modelAliasForAgent(agent: string, options: BenchmarkModelOptions): string | undefined {
  if (agent === "codex") return options.codexModel;
  if (agent === "kilo") return options.kiloModel;
  if (agent === "agy") return options.agyModel;
  return options.model;
}

export function benchmarkModels(options: BenchmarkModelOptions): Record<string, string | undefined> {
  return {
    pi: options.model,
    p: options.model,
    codex: options.agents.includes("codex") ? options.codexModel : undefined,
    kilo: options.agents.includes("kilo") ? options.kiloModel : undefined,
    agy: options.agents.includes("agy") ? options.agyModel : undefined,
  };
}
