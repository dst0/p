import { type Api, completeSimple, type Model } from "@dst0/p-ai";
import {
  createProjectInstructionCompilerFailure,
  createProjectInstructionCompilerOutputError,
  getProjectInstructionCompilerOutputDiagnostic,
  getProjectInstructionCompilerOutputFailureKind,
  type ProjectInstructionCompilerAttemptDiagnostic,
  type ProjectInstructionCompilerFailureKind,
  type ProjectInstructionCompilerOutputDiagnostic,
} from "./compiler-attempt-diagnostics.ts";
import { enforceProjectInstructionCompilerReasoningControl } from "./compiler-reasoning-control.ts";
import { parseProjectInstructionCompilerResponse } from "./compiler-response.ts";
import { deriveProjectInstructionTriggers } from "./compiler-triggers.ts";
import {
  materializeProjectInstructionCompilerResult,
  requiresConservativeAlwaysOn,
  validateProjectInstructionCompilerResult,
} from "./compiler-validation.ts";
import { PROJECT_INSTRUCTION_COMPILER_BODY_MAX_CHARS } from "./limits.ts";
import { buildProjectInstructionCompilerInput } from "./model-compiler-input.ts";
import {
  PROJECT_INSTRUCTION_COMPILER_SYSTEM_PROMPT,
  renderProjectInstructionCompilerRetryFeedback,
} from "./model-compiler-prompt.ts";
import type {
  ProjectInstructionClassifications,
  ProjectInstructionCompilerRequest,
  ProjectInstructionCompilerResult,
} from "./types.ts";

interface CompileProjectInstructionsWithModelOptions {
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxTokens?: number;
}

export async function compileProjectInstructionsWithModel(
  request: ProjectInstructionCompilerRequest,
  options: CompileProjectInstructionsWithModelOptions,
): Promise<ProjectInstructionCompilerResult> {
  const maxTokens = options.maxTokens ?? 4_096;
  const userContent = buildProjectInstructionCompilerInput(request);
  const controlledOptions = {
    ...options,
    model: enforceProjectInstructionCompilerReasoningControl(options.model),
  };
  return compileRequest(request, userContent, controlledOptions, maxTokens);
}

async function compileRequest(
  request: ProjectInstructionCompilerRequest,
  userContent: string,
  options: CompileProjectInstructionsWithModelOptions,
  maxTokens: number,
): Promise<ProjectInstructionCompilerResult> {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const startedAt = performance.now();
  const failureKinds: ProjectInstructionCompilerFailureKind[] = [];
  const attemptDiagnostics: ProjectInstructionCompilerAttemptDiagnostic[] = [];
  let retryFeedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptStartedAt = performance.now();
    let response: Awaited<ReturnType<typeof completeSimple>>;
    try {
      response = await completeSimple(
        options.model,
        {
          systemPrompt: PROJECT_INSTRUCTION_COMPILER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: `${userContent}${retryFeedback}`, timestamp: Date.now() }],
        },
        {
          apiKey: options.apiKey,
          headers: options.headers,
          timeoutMs: options.timeoutMs ?? 60_000,
          maxTokens,
          temperature: 0,
        },
      );
    } catch (error) {
      failureKinds.push("provider");
      attemptDiagnostics.push(
        createAttemptDiagnostic("provider", undefined, emptyUsage(), performance.now() - attemptStartedAt),
      );
      throw createProjectInstructionCompilerFailure(
        {
          attemptCount: failureKinds.length,
          failureKinds,
          attemptDiagnostics,
          usage,
          elapsedMs: performance.now() - startedAt,
        },
        isProviderContextFailure(error),
      );
    }
    usage.input += response.usage.input;
    usage.output += response.usage.output;
    usage.cacheRead += response.usage.cacheRead;
    usage.cacheWrite += response.usage.cacheWrite;
    usage.total += response.usage.totalTokens;
    const attemptUsage = normalizeUsage(response.usage);
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      failureKinds.push("provider");
      attemptDiagnostics.push(
        createAttemptDiagnostic("provider", undefined, attemptUsage, performance.now() - attemptStartedAt),
      );
      throw createProjectInstructionCompilerFailure(
        {
          attemptCount: failureKinds.length,
          failureKinds,
          attemptDiagnostics,
          usage,
          elapsedMs: performance.now() - startedAt,
        },
        isProviderContextFailure(response.errorMessage),
      );
    }
    try {
      return parseCompilerResult(
        request,
        response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim(),
        usage,
      );
    } catch (error) {
      const kind = getProjectInstructionCompilerOutputFailureKind(error) ?? "grounding-semantic";
      const diagnostic = getProjectInstructionCompilerOutputDiagnostic(error);
      failureKinds.push(kind);
      attemptDiagnostics.push(
        createAttemptDiagnostic(kind, diagnostic, attemptUsage, performance.now() - attemptStartedAt),
      );
      retryFeedback = renderProjectInstructionCompilerRetryFeedback(kind, diagnostic);
    }
  }
  throw createProjectInstructionCompilerFailure({
    attemptCount: failureKinds.length,
    failureKinds,
    attemptDiagnostics,
    usage,
    elapsedMs: performance.now() - startedAt,
  });
}

function parseCompilerResult(
  request: ProjectInstructionCompilerRequest,
  text: string,
  usage: NonNullable<ProjectInstructionCompilerResult["usage"]>,
): ProjectInstructionCompilerResult {
  let parsed: unknown;
  try {
    parsed = parseProjectInstructionCompilerResponse(text, isSparseCompilerEnvelope);
  } catch {
    throw createProjectInstructionCompilerOutputError("envelope");
  }
  if (!isSparseCompilerEnvelope(parsed)) {
    throw createProjectInstructionCompilerOutputError("root-schema");
  }
  const alwaysOnIds = parsed.alwaysOn;
  const selected = new Set(alwaysOnIds);
  const knownIds = new Set(request.constraints.map((constraint) => constraint.id));
  if (selected.size !== alwaysOnIds.length || alwaysOnIds.some((id) => !knownIds.has(id))) {
    throw createProjectInstructionCompilerOutputError("constraint-set");
  }
  const modelScopes: ProjectInstructionClassifications["constraints"] = {};
  for (const constraint of request.constraints) {
    modelScopes[constraint.id] = selected.has(constraint.id) ? "always-on" : "routed";
  }
  const classifications = deriveClassifications(modelScopes, request);
  let materialized: ProjectInstructionCompilerResult;
  try {
    const triggers = deriveProjectInstructionTriggers(classifications, request.modules, request.constraints);
    materialized = materializeProjectInstructionCompilerResult(
      classifications,
      triggers,
      request.constraints,
      usage,
      parsed.requires,
    );
  } catch {
    throw createProjectInstructionCompilerOutputError("grounding-semantic");
  }
  if (materialized.body.length > PROJECT_INSTRUCTION_COMPILER_BODY_MAX_CHARS) {
    const selectedCount = Object.values(classifications.constraints).filter((scope) => scope === "always-on").length;
    throw createProjectInstructionCompilerOutputError("grounding-semantic", {
      invariant: "body-budget",
      selectedCount,
      materializedBodyChars: materialized.body.length,
      hardLimitChars: PROJECT_INSTRUCTION_COMPILER_BODY_MAX_CHARS,
    });
  }
  try {
    return validateProjectInstructionCompilerResult(materialized, request.modules, request.constraints);
  } catch {
    throw createProjectInstructionCompilerOutputError("grounding-semantic");
  }
}

function createAttemptDiagnostic(
  kind: ProjectInstructionCompilerFailureKind,
  diagnostic: ProjectInstructionCompilerOutputDiagnostic | undefined,
  usage: ProjectInstructionCompilerAttemptDiagnostic["usage"],
  elapsedMs: number,
): ProjectInstructionCompilerAttemptDiagnostic {
  return { kind, ...diagnostic, usage, elapsedMs };
}

function normalizeUsage(
  usage: Awaited<ReturnType<typeof completeSimple>>["usage"],
): ProjectInstructionCompilerAttemptDiagnostic["usage"] {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total: usage.totalTokens,
  };
}

function emptyUsage(): ProjectInstructionCompilerAttemptDiagnostic["usage"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function isProviderContextFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /context (?:length|window)|maximum context|too many tokens|token limit/iu.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSparseCompilerEnvelope(
  value: unknown,
): value is { alwaysOn: string[]; requires?: Record<string, string[]> } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["alwaysOn", "requires"]) &&
    Array.isArray(value.alwaysOn) &&
    value.alwaysOn.every((id) => typeof id === "string") &&
    (value.requires === undefined || isStringArrayRecord(value.requires))
  );
}

function hasOnlyKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(record);
  return Object.hasOwn(record, "alwaysOn") && actual.every((key) => expected.includes(key));
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every((entry) => Array.isArray(entry) && entry.every(isString));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function deriveClassifications(
  modelScopes: ProjectInstructionClassifications["constraints"],
  request: ProjectInstructionCompilerRequest,
): ProjectInstructionClassifications {
  const derivedConstraints: ProjectInstructionClassifications["constraints"] = Object.fromEntries(
    request.constraints.map((constraint) => [
      constraint.id,
      requiresConservativeAlwaysOn(constraint) ? "always-on" : modelScopes[constraint.id],
    ]),
  );
  return {
    modules: Object.fromEntries(
      request.modules.map((module) => {
        const moduleConstraints = request.constraints.filter((constraint) => constraint.moduleId === module.id);
        return [
          module.id,
          moduleConstraints.length === 0 ||
          moduleConstraints.some(
            (constraint) => constraint.moduleId === module.id && derivedConstraints[constraint.id] === "always-on",
          )
            ? "always-on"
            : "routed",
        ];
      }),
    ),
    constraints: derivedConstraints,
  };
}
