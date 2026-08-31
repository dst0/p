type StartupProof = {
  requestedTaskVerificationMode?: unknown;
  effectiveTaskVerificationMode?: unknown;
  registeredVerificationTools?: unknown;
  activeVerificationTools?: unknown;
  verificationToolSurfaceRegistered?: unknown;
  verificationToolSurfaceActive?: unknown;
};

function exactStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

export function projectRuntimeTaskVerificationProof(evidence: {
  requestedTaskVerificationMode?: unknown;
  baseSystemModeProofs?: StartupProof[];
}) {
  const proofs = evidence.baseSystemModeProofs;
  const first = Array.isArray(proofs) ? proofs[0] : undefined;
  const requested =
    typeof evidence.requestedTaskVerificationMode === "string" ? evidence.requestedTaskVerificationMode : undefined;
  const effective =
    typeof first?.effectiveTaskVerificationMode === "string" ? first.effectiveTaskVerificationMode : undefined;
  const registeredTools = exactStrings(first?.registeredVerificationTools);
  const activeTools = exactStrings(first?.activeVerificationTools);
  if (
    !first ||
    !requested ||
    !effective ||
    !registeredTools ||
    !activeTools ||
    typeof first.verificationToolSurfaceRegistered !== "boolean" ||
    typeof first.verificationToolSurfaceActive !== "boolean"
  ) {
    return undefined;
  }
  return {
    requested,
    effective,
    registeredTools: [...registeredTools],
    activeTools: [...activeTools],
    toolSurfaceRegistered: first.verificationToolSurfaceRegistered,
    toolSurfaceActive: first.verificationToolSurfaceActive,
  };
}
