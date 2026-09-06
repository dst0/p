export const REQUIREMENT_PROOF_POLICIES = [
  "remove_exact_final_byte",
  "change_artifact_bytes",
  "preserve_state_on_failure",
  "preserve_log_on_failure",
  "preserve_version_on_failure",
  "preserve_position_on_failure",
  "preserve_command_identity_on_failure",
] as const;
