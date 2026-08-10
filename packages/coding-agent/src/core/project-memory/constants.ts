export const PROJECT_MEMORY_ROOT = ".pdev";

export const PROJECT_MEMORY_DIR = ".pdev/memory";

export const MAX_SEARCH_FILE_BYTES = 500_000;

export const MAX_SEARCH_RESULTS = 8;

export const MEMORY_FILE_TEMPLATES: ReadonlyArray<{ path: string; body: string }> = [
  {
    path: "projectbrief.md",
    body: "# Project Brief\n\nConcise durable project goal and scope. Keep this edited by humans or explicit memory commands.\n",
  },
  {
    path: "architecture.md",
    body: "# Architecture\n\nStable architecture notes, boundaries, and invariants.\n",
  },
  {
    path: "active-context.md",
    body: "# Active Context\n\nCurrent work context that should survive sessions. Keep entries short and source-backed.\n",
  },
  {
    path: "progress.md",
    body: "# Plan\n\nCurrent plan with status markers.\n",
  },
  {
    path: "decisions.md",
    body: "# Decisions\n\nDurable decisions with rationale and evidence pointers.\n",
  },
  {
    path: "commands.md",
    body: "# Commands\n\nUseful local commands, verification order, and known caveats.\n",
  },
  {
    path: "gotchas.md",
    body: "# Gotchas\n\nPinned constraints, recurring pitfalls, and recovery notes.\n",
  },
];
