const VERIFICATION_TOOL_NAMES = new Set(["record_requirement_audit", "record_task_verification"]);

export type VerificationToolSurface = {
  getActiveTools?: () => string[];
  getAllTools?: () => Array<{ name?: unknown }>;
};

export type VerificationStartupProof = {
  requestedTaskVerificationMode?: string;
  effectiveTaskVerificationMode?: string;
  registeredVerificationTools: string[];
  activeVerificationTools: string[];
  verificationToolSurfaceRegistered: boolean;
  verificationToolSurfaceActive: boolean;
};

export function expectedVerificationTools(mode: string | undefined): string[] {
  if (mode === "audit") return ["record_requirement_audit", "record_task_verification"];
  return mode === "evidence" ? ["record_task_verification"] : [];
}

function sameTools(actual: unknown, expected: string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((name, index) => typeof name === "string" && name === expected[index])
  );
}

export function captureVerificationStartupProof(
  effectiveMode: string | undefined,
  surface: VerificationToolSurface | undefined,
): Omit<VerificationStartupProof, "requestedTaskVerificationMode"> {
  let registeredVerificationTools: string[] = [];
  let activeVerificationTools: string[] = [];
  try {
    registeredVerificationTools = [
      ...new Set(
        (surface?.getAllTools?.() ?? [])
          .map((tool) => tool.name)
          .filter((name): name is string => typeof name === "string" && VERIFICATION_TOOL_NAMES.has(name)),
      ),
    ].sort();
    activeVerificationTools = [
      ...new Set((surface?.getActiveTools?.() ?? []).filter((name) => VERIFICATION_TOOL_NAMES.has(name))),
    ].sort();
  } catch {
    registeredVerificationTools = [];
    activeVerificationTools = [];
  }
  return {
    effectiveTaskVerificationMode: effectiveMode,
    registeredVerificationTools,
    activeVerificationTools,
    verificationToolSurfaceRegistered: registeredVerificationTools.length > 0,
    verificationToolSurfaceActive:
      activeVerificationTools.length > 0 && sameTools(activeVerificationTools, registeredVerificationTools),
  };
}

export function taskVerificationStartupFailure(proof: VerificationStartupProof): string | undefined {
  const requested = proof.requestedTaskVerificationMode;
  if (requested === undefined) return undefined;
  if (proof.effectiveTaskVerificationMode !== requested || !["evidence", "audit", "off"].includes(requested)) {
    return "effective task-verification profile does not match the requested profile";
  }
  const expected = expectedVerificationTools(requested);
  if (!sameTools(proof.registeredVerificationTools, expected)) {
    return "registered task-verification tool inventory does not match the requested profile";
  }
  if (!sameTools(proof.activeVerificationTools, expected)) {
    return "active task-verification tool inventory does not match the requested profile";
  }
  const controllerExpected = requested !== "off";
  if (
    proof.verificationToolSurfaceRegistered !== controllerExpected ||
    proof.verificationToolSurfaceActive !== controllerExpected
  ) {
    return "task-verification tool-surface registration or activation does not match the requested profile";
  }
  return undefined;
}
