export function didAgentTurnFail(result: {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}): boolean {
  return result.code !== 0 || result.signal !== null || result.error !== undefined;
}
