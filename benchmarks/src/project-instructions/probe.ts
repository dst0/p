import { createHash } from "node:crypto";
import { parseCompiledProjectInstructionMarker } from "./marker.ts";
import { consumeProjectInstructionProofEnvironment, sendProjectInstructionProof } from "./proof-ipc.ts";

const LEGACY_MARKER = /<project_context>|<project_instructions path="/u;
const PROJECT_INSTRUCTION_PREFLIGHT_EXIT_CODE = 86;
const MAX_FULL_LEGACY_CONTEXT_CHARS = 6000;
const MAX_COMPACT_LEGACY_CONTEXT_CHARS = 6000;
const LEGACY_RULE_KEYWORD_PATTERN =
  /\b(always|ask|before|block|cannot|commands?|do not|don't|must|never|no \w+|only|required|rules?|run|should|test|use \w+|verify)\b|^\s*(No |Prefer |Avoid |For |Use )/i;

type ProbeRuntime = {
  connected: boolean;
  disconnect: () => void;
  env: NodeJS.ProcessEnv;
  exit(code: number): unknown;
  send?: NodeJS.Process["send"];
  stderr: { write(value: string): unknown };
};

type ContextFile = { path?: string; content?: string };
type BaseSystemEvent = {
  systemPrompt?: unknown;
  systemPromptOptions?: { contextFiles?: unknown; projectInstructions?: unknown };
};

export type BaseSystemModeProof = {
  requestedMode: string;
  sourceSha256: string;
  systemPromptSha256: string;
  systemPromptBytes: number;
  hasLegacyMarker: boolean;
  hasCompiledMarker: boolean;
  compiledAgentsHash?: string;
  compiledInputHash?: string;
  compiledArtifactMode?: string;
  compiledInstructionsSha256?: string;
  compiledInstructionsInjected: boolean;
  sourceLoaded: boolean;
  legacySourceInjected: boolean;
  legacyInjectedBlockHashes: string[];
  legacyExpectedBlockHashes: string[];
};

type ProbeHost = { on(event: "before_agent_start", listener: (event: BaseSystemEvent) => Promise<void>): unknown };

function hardStopProjectInstructionPreflight(runtime: ProbeRuntime, message: string): void {
  if (runtime.connected === true && typeof runtime.disconnect === "function") {
    try {
      runtime.disconnect();
    } catch {
      // Exiting the benchmark process remains the fail-closed boundary.
    }
  }
  runtime.stderr.write(`[project-instruction-preflight] ${message}\n`);
  runtime.exit(PROJECT_INSTRUCTION_PREFLIGHT_EXIT_CODE);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function formatLegacyContextFileForProof(filePath: string, content: string): string {
  if (content.length <= MAX_FULL_LEGACY_CONTEXT_CHARS) return content;
  const selectedLines = [
    `[Large project rules file compacted from ${content.length} chars.]`,
    `Full rules remain available at ${filePath}; read the file before broad changes or when exact wording matters.`,
    "",
  ];
  let omitted = 0;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || LEGACY_RULE_KEYWORD_PATTERN.test(trimmed)) selectedLines.push(line);
    else omitted += 1;
    if (selectedLines.join("\n").length >= MAX_COMPACT_LEGACY_CONTEXT_CHARS) break;
  }
  if (omitted > 0) selectedLines.push("", `[${omitted} lower-signal lines omitted from prompt context.]`);
  const compacted = selectedLines.join("\n");
  if (compacted.length <= MAX_COMPACT_LEGACY_CONTEXT_CHARS) return compacted;
  return `${compacted.slice(0, MAX_COMPACT_LEGACY_CONTEXT_CHARS - 80).trimEnd()}\n[compacted rules truncated to prompt budget]`;
}

function legacySourceProof(
  systemPrompt: string,
  contextFiles: ContextFile[],
  expectedSourceSha256: string,
  expectedSourcePath?: string,
) {
  const matchingSources = contextFiles.filter(
    (file) =>
      typeof file?.content === "string" &&
      hashText(file.content) === expectedSourceSha256 &&
      (expectedSourcePath === undefined || file.path === expectedSourcePath),
  );
  const injectedBlockHashes: string[] = [];
  const expectedBlockHashes: string[] = [];
  let legacySourceInjected = false;
  for (const source of matchingSources) {
    if (typeof source.path !== "string" || typeof source.content !== "string") continue;
    const expectedBlockHash = hashText(formatLegacyContextFileForProof(source.path, source.content));
    expectedBlockHashes.push(expectedBlockHash);
    const opening = `<project_instructions path="${source.path}">\n`;
    const start = systemPrompt.indexOf(opening);
    if (start < 0) continue;
    const contentStart = start + opening.length;
    const end = systemPrompt.indexOf("\n</project_instructions>", contentStart);
    if (end >= contentStart) {
      const injectedBlockHash = hashText(systemPrompt.slice(contentStart, end));
      injectedBlockHashes.push(injectedBlockHash);
      if (injectedBlockHash === expectedBlockHash) legacySourceInjected = true;
    }
  }
  return {
    sourceLoaded: matchingSources.length > 0,
    legacySourceInjected,
    legacyInjectedBlockHashes: injectedBlockHashes,
    legacyExpectedBlockHashes: expectedBlockHashes,
  };
}

function hasExpectedLegacyInjection(proof: BaseSystemModeProof): boolean {
  const expected = Array.isArray(proof.legacyExpectedBlockHashes) ? proof.legacyExpectedBlockHashes : [];
  const injected = Array.isArray(proof.legacyInjectedBlockHashes) ? proof.legacyInjectedBlockHashes : [];
  return expected.length > 0 && expected.some((hash) => injected.includes(hash));
}

export function createBaseSystemModeProof(
  event: BaseSystemEvent,
  requestedMode: string,
  expectedSourceSha256: string,
  expectedSourcePath?: string,
): BaseSystemModeProof {
  const systemPrompt = typeof event?.systemPrompt === "string" ? event.systemPrompt : "";
  const options = event?.systemPromptOptions ?? {};
  const contextFiles = Array.isArray(options.contextFiles) ? (options.contextFiles as ContextFile[]) : [];
  const projectInstructions = typeof options.projectInstructions === "string" ? options.projectInstructions : undefined;
  const compiled = parseCompiledProjectInstructionMarker(systemPrompt);
  return {
    requestedMode,
    sourceSha256: expectedSourceSha256,
    systemPromptSha256: hashText(systemPrompt),
    systemPromptBytes: Buffer.byteLength(systemPrompt, "utf8"),
    hasLegacyMarker: LEGACY_MARKER.test(systemPrompt),
    hasCompiledMarker: compiled !== undefined,
    compiledAgentsHash: compiled?.agentsSha256,
    compiledInputHash: compiled?.inputSha256,
    compiledArtifactMode: compiled?.mode,
    compiledInstructionsSha256: projectInstructions ? hashText(projectInstructions) : undefined,
    compiledInstructionsInjected: projectInstructions ? systemPrompt.includes(projectInstructions) : false,
    ...legacySourceProof(systemPrompt, contextFiles, expectedSourceSha256, expectedSourcePath),
  };
}

export function projectInstructionPreflightFailure(proof: BaseSystemModeProof): string | undefined {
  if (
    proof.requestedMode === "compiled" &&
    (proof.hasLegacyMarker ||
      !proof.hasCompiledMarker ||
      !proof.compiledInstructionsInjected ||
      proof.compiledArtifactMode !== "compiled")
  ) {
    return "compiled startup proof is invalid or the compiler did not produce a successful compiled artifact";
  }
  if (
    proof.requestedMode === "legacy" &&
    (!proof.sourceLoaded ||
      !proof.legacySourceInjected ||
      !hasExpectedLegacyInjection(proof) ||
      !proof.hasLegacyMarker ||
      proof.hasCompiledMarker)
  ) {
    return "legacy startup proof does not contain the expected legacy project-instruction rendering";
  }
  return undefined;
}

export default function projectInstructionBenchmarkProbe(p: ProbeHost, runtime: ProbeRuntime = process): void {
  const config = consumeProjectInstructionProofEnvironment(runtime.env);
  if (!config) return;
  p.on("before_agent_start", async (event) => {
    const proof = createBaseSystemModeProof(event, config.requestedMode, config.sourceSha256, config.sourcePath);
    try {
      await sendProjectInstructionProof(config, proof, runtime);
    } catch {
      hardStopProjectInstructionPreflight(runtime, "startup-proof IPC delivery failed");
      return;
    }
    const failure = projectInstructionPreflightFailure(proof);
    if (failure) {
      hardStopProjectInstructionPreflight(runtime, failure);
    }
  });
}
