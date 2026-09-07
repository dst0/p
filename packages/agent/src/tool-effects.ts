export type ToolEffectKind = "read" | "workspace_write" | "external_write" | "unknown";

export type ToolEffectRisk = "normal" | "high";

export type ToolEffectDomain =
  | "credentials"
  | "destructive"
  | "deployment"
  | "network_send"
  | "persistent_state"
  | "publication";

export type ToolEffectSource = "builtin" | "declared" | "default_unknown";

export interface ToolEffectDeclaration {
  kind: ToolEffectKind;
  risk: ToolEffectRisk;
  domains?: readonly ToolEffectDomain[];
}

export interface ResolvedToolEffect extends ToolEffectDeclaration {
  domains: readonly ToolEffectDomain[];
  source: ToolEffectSource;
}

const RESOLVED_EFFECTS = new WeakSet<object>();

const DEFAULT_UNKNOWN_TOOL_EFFECT: ResolvedToolEffect = Object.freeze({
  kind: "unknown",
  risk: "high",
  domains: Object.freeze([]),
  source: "default_unknown",
});
RESOLVED_EFFECTS.add(DEFAULT_UNKNOWN_TOOL_EFFECT);

const VALID_DOMAINS = new Set<ToolEffectDomain>([
  "credentials",
  "destructive",
  "deployment",
  "network_send",
  "persistent_state",
  "publication",
]);

function isToolEffectKind(value: unknown): value is ToolEffectKind {
  return value === "read" || value === "workspace_write" || value === "external_write" || value === "unknown";
}

function isToolEffectRisk(value: unknown): value is ToolEffectRisk {
  return value === "normal" || value === "high";
}

export function resolveToolEffect(
  declaration: ToolEffectDeclaration | ResolvedToolEffect | undefined,
  source: Exclude<ToolEffectSource, "default_unknown"> = "declared",
): ResolvedToolEffect {
  if (declaration && RESOLVED_EFFECTS.has(declaration)) {
    return declaration as ResolvedToolEffect;
  }
  if (!declaration || !isToolEffectKind(declaration.kind) || !isToolEffectRisk(declaration.risk)) {
    return DEFAULT_UNKNOWN_TOOL_EFFECT;
  }
  if (
    declaration.domains !== undefined &&
    (!Array.isArray(declaration.domains) ||
      declaration.domains.some(
        (domain) => typeof domain !== "string" || !VALID_DOMAINS.has(domain as ToolEffectDomain),
      ))
  ) {
    return DEFAULT_UNKNOWN_TOOL_EFFECT;
  }
  const domains = Array.from(new Set(declaration.domains ?? []));
  const resolved = Object.freeze({
    kind: declaration.kind,
    risk: declaration.risk,
    domains: Object.freeze(domains),
    source: source === "builtin" ? "builtin" : "declared",
  });
  RESOLVED_EFFECTS.add(resolved);
  return resolved;
}

export function toolEffectRequiresVerification(effect: ResolvedToolEffect): boolean {
  return effect.kind !== "read" || effect.risk === "high";
}
