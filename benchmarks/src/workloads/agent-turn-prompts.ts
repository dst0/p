export const agentTurnNudgePrompts = {
  nudge:
    "Are you done with the task or is there anything left? If you are finished, ensure all requirements are satisfied and create finish_notes.md.",
  terminalRecovery:
    "finish_notes.md exists, but P has not completed its terminal verification. Complete fresh verification and its terminal action.",
} as const;
