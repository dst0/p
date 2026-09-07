type UserTurn = {
  eventOrdinal: number;
  expectedRouteLinks: string[];
  selectionVerified?: boolean;
};
type RuntimeRoute = {
  eventOrdinal: number;
  routeInputHash?: string;
  routeLinkCount: number;
  routeLinks: string[];
};
type ReadRulesBatch = {
  succeeded?: boolean;
  startOrdinal: number;
  endOrdinal: number;
  links: string[];
};
type ActionCall = {
  toolName?: string;
  eventOrdinal: number;
  endOrdinal: number;
  selectionVerified?: boolean;
  phases?: string[];
  expectedActionRuleLinks?: string[];
  projectRuleGateBlockKind?: string;
  pendingRuleBatches?: string[][];
  blockedByProjectRuleGate?: boolean;
};
type RoutedTurnEvidence = {
  userTurns?: UserTurn[];
  runtimeContexts?: RuntimeRoute[];
  readRulesBatches?: ReadRulesBatch[];
  phaseRelevantToolCalls?: ActionCall[];
};

const DIAGNOSTIC_BUILTIN_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "generate_image",
  "process",
  "recall_learnings",
  "record_learning",
  "record_requirement_audit",
  "record_task_verification",
  "rg",
  "run_subagent",
  "submit_plan",
  "write",
]);

export function validateRoutedTurns(
  evidence: RoutedTurnEvidence,
  cache: { manifest: { inputHash: string } },
): string | undefined {
  const turns = Array.isArray(evidence.userTurns)
    ? [...evidence.userTurns].sort((left, right) => left.eventOrdinal - right.eventOrdinal)
    : [];
  if (turns.length === 0 || turns.some((turn) => !turn.selectionVerified || !Number.isInteger(turn.eventOrdinal))) {
    return "compiled user-turn routing evidence is missing";
  }
  const contexts = Array.isArray(evidence.runtimeContexts) ? evidence.runtimeContexts : [];
  const routes = contexts.filter((context) => context.routeInputHash !== undefined || context.routeLinkCount > 0);
  const batches = Array.isArray(evidence.readRulesBatches) ? evidence.readRulesBatches : [];
  const actions = Array.isArray(evidence.phaseRelevantToolCalls) ? evidence.phaseRelevantToolCalls : [];
  const usedRoutes = new Set<RuntimeRoute>();
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const end = turns[index + 1]?.eventOrdinal ?? Number.POSITIVE_INFINITY;
    const turnRoutes = routes.filter((route) => route.eventOrdinal > turn.eventOrdinal && route.eventOrdinal < end);
    if (turn.expectedRouteLinks.length === 0) {
      if (turnRoutes.length > 0) return "zero-route turn emitted an unexpected runtime route";
      continue;
    }
    if (turnRoutes.length !== 1) return "every routed turn must emit exactly one runtime route";
    const [route] = turnRoutes;
    usedRoutes.add(route);
    if (
      route.routeInputHash !== cache.manifest.inputHash ||
      route.routeLinkCount < 1 ||
      route.routeLinkCount > 3 ||
      !sameLinks(route.routeLinks, turn.expectedRouteLinks)
    ) {
      return "compiled runtime route does not match recomputed selection";
    }
  }
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const end = turns[index + 1]?.eventOrdinal ?? Number.POSITIVE_INFINITY;
    const successfulTurnBatches = batches.filter(
      (batch) =>
        batch.succeeded === true &&
        Number.isInteger(batch.startOrdinal) &&
        Number.isInteger(batch.endOrdinal) &&
        batch.startOrdinal > turn.eventOrdinal &&
        batch.endOrdinal < end,
    );
    const turnActions = actions
      .filter((call) => call.eventOrdinal > turn.eventOrdinal && call.eventOrdinal < end)
      .sort((left, right) => left.eventOrdinal - right.eventOrdinal);
    let authoritativeLinks: string[] | undefined;
    let authoritativeRead: ReadRulesBatch | undefined;
    for (const action of turnActions) {
      if (
        !action.selectionVerified ||
        !Array.isArray(action.phases) ||
        !Array.isArray(action.expectedActionRuleLinks)
      ) {
        return "compiled mutating-action selection evidence is missing";
      }
      if (
        action.expectedActionRuleLinks.length > 3 ||
        new Set(action.expectedActionRuleLinks).size !== action.expectedActionRuleLinks.length
      ) {
        return "compiled mutating action selected an invalid rule-link batch";
      }
      if (action.projectRuleGateBlockKind === "pending") {
        if (!Array.isArray(action.pendingRuleBatches) || action.pendingRuleBatches.length !== 1) {
          return "runtime pending action batches are missing from benchmark evidence";
        }
        const pendingBatch = action.pendingRuleBatches[0];
        if (authoritativeLinks) {
          if (!sameLinks(pendingBatch, authoritativeLinks)) {
            return "compiled user turn requested more than one authoritative rule batch";
          }
        } else {
          const expected = authoritativeBatchLinks(turn.expectedRouteLinks, action.expectedActionRuleLinks);
          if (pendingBatch.length < 1 || pendingBatch.length > 3 || !sameOrderedLinks(pendingBatch, expected)) {
            return "runtime authoritative batch does not match action-first query and mutating-action selection";
          }
          authoritativeLinks = pendingBatch;
          const matchingReads = successfulTurnBatches.filter(
            (batch) => batch.startOrdinal > action.endOrdinal && sameLinks(batch.links, authoritativeLinks),
          );
          if (matchingReads.length !== 1) {
            return "authoritative project-rule batch requires exactly one successful read_rules call";
          }
          authoritativeRead = matchingReads[0];
        }
      }
      if (action.projectRuleGateBlockKind === "cap" || action.projectRuleGateBlockKind === "fixed") {
        return "runtime tried to reroute or restage the sole authoritative batch";
      }
      if (action.blockedByProjectRuleGate !== false) continue;
      const requiredLinks = authoritativeBatchLinks(turn.expectedRouteLinks, action.expectedActionRuleLinks);
      if (requiredLinks.length === 0) continue;
      if (!authoritativeLinks) {
        return `completed mutating action had no authoritative rule batch: ${actionIdentity(action)}`;
      }
      if (!authoritativeRead || authoritativeRead.endOrdinal >= action.eventOrdinal) {
        return "authoritative read_rules call did not complete before the mutating action";
      }
    }
  }
  if (routes.some((route) => !usedRoutes.has(route))) {
    return "runtime route is not attached to a captured user turn";
  }
  if (routes.some((route) => !Number.isInteger(route.eventOrdinal))) return "runtime route ordinal is missing";
  return undefined;
}

function authoritativeBatchLinks(turnLinks: string[], actionLinks: string[]): string[] {
  const primaryActionLink = actionLinks[0];
  return [...new Set([...(primaryActionLink ? [primaryActionLink] : []), ...turnLinks, ...actionLinks.slice(1)])].slice(
    0,
    3,
  );
}

function sameLinks(left: unknown, right: unknown): boolean {
  if (!isStringArray(left) || !isStringArray(right) || left.length !== right.length) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  const expected = [...right].sort();
  return [...left].sort().every((link, index) => link === expected[index]);
}

function sameOrderedLinks(left: unknown, right: unknown): boolean {
  if (!isStringArray(left) || !isStringArray(right) || left.length !== right.length) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return left.every((link, index) => link === right[index]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function actionIdentity(action: ActionCall): string {
  const toolName =
    typeof action.toolName === "string" && DIAGNOSTIC_BUILTIN_TOOL_NAMES.has(action.toolName)
      ? action.toolName
      : "custom";
  const eventOrdinal = Number.isInteger(action.eventOrdinal) ? String(action.eventOrdinal) : "unknown";
  return `tool=${toolName}, event=${eventOrdinal}`;
}
