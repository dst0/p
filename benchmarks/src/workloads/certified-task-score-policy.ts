export const certifiedTaskMaxScore = {
  "typescript-calculator": 8,
  "monolith-split": 8,
  "event-sourced-inventory": 108,
  "durable-workflow-saga": 170,
} as const;

export type CertifiedTaskId = keyof typeof certifiedTaskMaxScore;

export const certifiedTaskIds = Object.keys(certifiedTaskMaxScore) as CertifiedTaskId[];

export function certifiedTaskMaxScoreFor(taskId: string): number | undefined {
  return certifiedTaskMaxScore[taskId as CertifiedTaskId];
}
