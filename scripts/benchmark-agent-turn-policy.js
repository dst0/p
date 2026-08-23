export function didAgentTurnFail(result) {
  return result.code !== 0 || result.signal !== null || result.error !== undefined;
}
