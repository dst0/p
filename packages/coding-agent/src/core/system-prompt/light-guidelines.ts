/** Short guideline set for the LIGHT verification tier: answer directly, no completion ceremony. */
export const LIGHT_GUIDELINES: readonly string[] = [
  "Be concise and show file paths clearly.",
  "Answer in plain text as soon as you have enough evidence, and name the files or command output you relied on.",
  "Read before editing, keep changes minimal, and end created or edited text files with '\\n' unless asked otherwise.",
  "After changing files, list the changed paths in your answer.",
  "Treat exit status as authoritative; report failures instead of masking them.",
];

/** One-line pointer to p's own documentation for the LIGHT tier. */
export function formatLightDocsPointer(readmePath: string, docsPath: string): string {
  return `p documentation (only for questions about p itself): ${readmePath} and ${docsPath}`;
}
