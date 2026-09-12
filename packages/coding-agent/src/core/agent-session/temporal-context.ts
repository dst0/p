export function formatTemporalContext(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `<temporal_context>Current date: ${year}-${month}-${day}. Use it to interpret today, tomorrow, yesterday, and other relative dates.</temporal_context>`;
}
