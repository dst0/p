import chalk from "chalk";
import { parseArgs, printHelp } from "../cli/args.ts";
import { listModels } from "../cli/list-models.ts";
import { createProjectTrustContext } from "../cli/project-trust.ts";
import { shouldRunFirstTimeSetup, showFirstTimeSetup } from "../cli/startup-ui.ts";
import {
  ENV_SESSION_DIR,
  expandTildePath,
  getAgentDir,
  getPackageDir,
  installLegacyAgentDirEnvAlias,
  VERSION,
} from "../config.ts";
import { type CreateAgentSessionRuntimeFactory, createAgentSessionRuntime } from "../core/agent-session-runtime.ts";
import {
  type AgentSessionRuntimeDiagnostic,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "../core/agent-session-services.ts";
import { formatNoModelsAvailableMessage } from "../core/auth-guidance.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import { exportFromFile } from "../core/export-html/index.ts";
import { configureHttpDispatcher } from "../core/http-dispatcher.ts";
import { resolveModelScope } from "../core/model-resolver.ts";
import { restoreStdout, takeOverStdout } from "../core/output-guard.ts";
import { type AppMode, resolveProjectTrusted } from "../core/project-trust.ts";
import { getMissingSessionCwdIssue, MissingSessionCwdError } from "../core/session-cwd.ts";
import { SessionManager } from "../core/session-manager.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { printTimings, resetTimings, time } from "../core/timings.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { runMigrations, showDeprecationWarnings } from "../migrations.ts";
import { InteractiveMode, runPrintMode, runRpcMode } from "../modes/index.ts";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.ts";
import { handleConfigCommand, handlePackageCommand } from "../package-manager-cli.ts";
import { normalizePath } from "../utils/paths.ts";
import { cleanupWindowsSelfUpdateQuarantine } from "../utils/windows-self-update.ts";
import {
  collectSettingsDiagnostics,
  isPlainRuntimeMetadataCommand,
  isTruthyEnvFlag,
  prepareInitialMessage,
  readPipedStdin,
  reportDiagnostics,
  resolveAppMode,
  toPrintOutputMode,
  validateForkFlags,
} from "./helpers-part1.ts";
import { createSessionManager, validateSessionIdFlags } from "./helpers-part2.ts";
import { buildSessionOptions, promptForMissingSessionCwd, resolveCliPaths } from "./helpers-part3.ts";
import type { MainOptions } from "./types.ts";

export async function main(args: string[], options?: MainOptions) {
  resetTimings();
  installLegacyAgentDirEnvAlias();
  const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.P_OFFLINE);
  if (offlineMode) {
    process.env.P_OFFLINE = "1";
    process.env.P_SKIP_VERSION_CHECK = "1";
  }

  if (process.platform === "win32") {
    cleanupWindowsSelfUpdateQuarantine(getPackageDir());
  }

  if (await handlePackageCommand(args, { extensionFactories: options?.extensionFactories })) {
    process.exit(process.exitCode ?? 0);
    return;
  }

  if (await handleConfigCommand(args, { extensionFactories: options?.extensionFactories })) {
    return;
  }

  const parsed = parseArgs(args);
  if (parsed.diagnostics.length > 0) {
    for (const d of parsed.diagnostics) {
      const color = d.type === "error" ? chalk.red : chalk.yellow;
      console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
    }
    if (parsed.diagnostics.some((d) => d.type === "error")) {
      process.exit(1);
    }
  }
  time("parseArgs");

  if (parsed.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (parsed.export) {
    let result: string;
    try {
      const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
      result = await exportFromFile(parsed.export, outputPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to export session";
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
    console.log(`Exported to: ${result}`);
    process.exit(0);
  }

  let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
  const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
  if (shouldTakeOverStdout) {
    takeOverStdout();
  }

  if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
    console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
    process.exit(1);
  }

  validateForkFlags(parsed);
  validateSessionIdFlags(parsed);

  // Run migrations (pass cwd for project-local migrations)
  const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(process.cwd());
  time("runMigrations");

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const startupSettingsManager = SettingsManager.create(cwd, agentDir);
  reportDiagnostics(collectSettingsDiagnostics(startupSettingsManager, "startup session lookup"));

  // Experimental first-time setup: theme choice and analytics opt-in.
  // Runs before any runtime services are created so the chosen settings apply everywhere.
  if (appMode === "interactive" && !parsed.help && parsed.listModels === undefined && shouldRunFirstTimeSetup()) {
    await showFirstTimeSetup(startupSettingsManager);
    time("firstTimeSetup");
  }

  // Decide the final runtime cwd before creating cwd-bound runtime services.
  // --session and --resume may select a session from another project, so project-local
  // settings, resources, provider registrations, and models must be resolved only after
  // the target session cwd is known. The startup-cwd settings manager is used only for
  // sessionDir lookup during session selection.
  const envSessionDir = process.env[ENV_SESSION_DIR];
  const sessionDir =
    (parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined) ??
    (envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
    startupSettingsManager.getSessionDir();
  installLegacyAgentDirEnvAlias(sessionDir);
  let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
  const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
  if (missingSessionCwdIssue) {
    if (appMode === "interactive") {
      const selectedCwd = await promptForMissingSessionCwd(missingSessionCwdIssue, startupSettingsManager);
      if (!selectedCwd) {
        process.exit(0);
      }
      sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
    } else {
      console.error(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message));
      process.exit(1);
    }
  }
  if (parsed.name !== undefined) {
    const name = parsed.name.trim();
    if (!name) {
      console.error(chalk.red("Error: --name requires a non-empty value"));
      process.exit(1);
    }
    sessionManager.appendSessionInfo(name);
  }
  time("createSessionManager");

  const trustStore = new ProjectTrustStore(agentDir);
  const sessionCwd = sessionManager.getCwd();
  const autoTrustOnReloadCwd =
    parsed.projectTrustOverride === undefined && !hasTrustRequiringProjectResources(sessionCwd)
      ? sessionCwd
      : undefined;
  const trustPromptMode: AppMode = parsed.help || parsed.listModels !== undefined ? "print" : appMode;
  const projectTrustByCwd = new Map<string, boolean>();

  const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
  const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
  const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
  const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
  const authStorage = AuthStorage.create();
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
    projectTrustContext,
  }) => {
    const isInitialRuntime = sessionStartEvent === undefined;
    const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
    const cachedProjectTrust = projectTrustByCwd.get(cwd);
    const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
    const shouldResolveProjectTrust =
      parsed.projectTrustOverride === undefined && cachedProjectTrust === undefined && hasTrustRequiringResources;
    const projectTrusted = shouldResolveProjectTrust
      ? false
      : (cachedProjectTrust ??
        parsed.projectTrustOverride ??
        (!hasTrustRequiringResources || trustStore.get(cwd) === true));
    const runtimeSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      authStorage,
      settingsManager: runtimeSettingsManager,
      extensionFlagValues: parsed.unknownFlags,
      resourceLoaderReloadOptions: shouldResolveProjectTrust
        ? {
            resolveProjectTrust: async ({ extensionsResult }) => {
              const trusted = await resolveProjectTrusted({
                cwd,
                trustStore,
                trustOverride: parsed.projectTrustOverride,
                defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
                extensionsResult,
                projectTrustContext:
                  projectTrustContext ??
                  createProjectTrustContext({
                    cwd,
                    mode: isInitialRuntime ? trustPromptMode : appMode,
                    settingsManager: startupSettingsManager,
                    hasUI: isInitialRuntime && trustPromptMode === "interactive",
                  }),
                onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
              });
              projectTrustByCwd.set(cwd, trusted);
              return trusted;
            },
          }
        : undefined,
      resourceLoaderOptions: {
        additionalExtensionPaths: resolvedExtensionPaths,
        additionalSkillPaths: resolvedSkillPaths,
        additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
        additionalThemePaths: resolvedThemePaths,
        noExtensions: parsed.noExtensions,
        noSkills: parsed.noSkills,
        noPromptTemplates: parsed.noPromptTemplates,
        noThemes: parsed.noThemes,
        noContextFiles: parsed.noContextFiles,
        systemPrompt: parsed.systemPrompt,
        appendSystemPrompt: parsed.appendSystemPrompt,
        extensionFactories: options?.extensionFactories,
      },
    });
    const { settingsManager, modelRegistry, resourceLoader } = services;
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...projectTrustDiagnostics,
      ...services.diagnostics,
      ...collectSettingsDiagnostics(settingsManager, "runtime creation"),
      ...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
        type: "error" as const,
        message: `Failed to load extension "${path}": ${error}`,
      })),
    ];

    const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
    const scopedModels =
      modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
    const {
      options: sessionOptions,
      cliThinkingFromModel,
      diagnostics: sessionOptionDiagnostics,
    } = buildSessionOptions(
      parsed,
      appMode,
      scopedModels,
      sessionManager.buildSessionContext().messages.length > 0,
      modelRegistry,
      settingsManager,
    );
    diagnostics.push(...sessionOptionDiagnostics);

    if (parsed.apiKey) {
      if (!sessionOptions.model) {
        diagnostics.push({
          type: "error",
          message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
        });
      } else {
        authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
      }
    }

    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model: sessionOptions.model,
      thinkingLevel: sessionOptions.thinkingLevel,
      scopedModels: sessionOptions.scopedModels,
      tools: sessionOptions.tools,
      userInputTools: sessionOptions.userInputTools,
      excludeTools: sessionOptions.excludeTools,
      noTools: sessionOptions.noTools,
      customTools: sessionOptions.customTools,
      completionMode: sessionOptions.completionMode,
      completionLimits: sessionOptions.completionLimits,
      maxTokens: sessionOptions.maxTokens,
    });
    const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
    if (created.session.model && cliThinkingOverride) {
      created.session.setThinkingLevel(created.session.thinkingLevel);
    }

    return {
      ...created,
      services,
      diagnostics,
    };
  };
  time("createRuntime");
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir,
    sessionManager,
  });
  time("createAgentSessionRuntime");
  const { services, session, modelFallbackMessage } = runtime;
  const { settingsManager, modelRegistry, resourceLoader } = services;
  configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());

  if (parsed.help) {
    const extensionFlags = resourceLoader
      .getExtensions()
      .extensions.flatMap((extension) => Array.from(extension.flags.values()));
    printHelp(extensionFlags);
    process.exit(0);
  }

  if (parsed.listModels !== undefined) {
    const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
    await listModels(modelRegistry, searchPattern);
    process.exit(0);
  }

  // Read piped stdin content (if any) - skip for RPC mode which uses stdin for JSON-RPC
  let stdinContent: string | undefined;
  if (appMode !== "rpc") {
    stdinContent = await readPipedStdin();
    if (stdinContent !== undefined && appMode === "interactive") {
      appMode = "print";
    }
  }
  time("readPipedStdin");

  const { initialMessage, initialImages } = await prepareInitialMessage(
    parsed,
    settingsManager.getImageAutoResize(),
    stdinContent,
  );
  time("prepareInitialMessage");
  initTheme(settingsManager.getTheme(), appMode === "interactive");
  time("initTheme");

  // Show deprecation warnings in interactive mode
  if (appMode === "interactive" && deprecationWarnings.length > 0) {
    await showDeprecationWarnings(deprecationWarnings);
  }

  time("resolveModelScope");
  reportDiagnostics(runtime.diagnostics);
  if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
    process.exit(1);
  }
  time("createAgentSession");

  if (appMode !== "interactive" && !session.model) {
    console.error(chalk.red(formatNoModelsAvailableMessage()));
    process.exit(1);
  }

  const startupBenchmark = isTruthyEnvFlag(process.env.PI_STARTUP_BENCHMARK);
  if (startupBenchmark && appMode !== "interactive") {
    console.error(chalk.red("Error: PI_STARTUP_BENCHMARK only supports interactive mode"));
    process.exit(1);
  }

  if (appMode === "rpc") {
    printTimings();
    await runRpcMode(runtime);
  } else if (appMode === "interactive") {
    const interactiveMode = new InteractiveMode(runtime, {
      migratedProviders,
      modelFallbackMessage,
      autoTrustOnReloadCwd,
      initialMessage,
      initialImages,
      initialMessages: parsed.messages,
      verbose: parsed.verbose,
    });
    if (startupBenchmark) {
      await interactiveMode.init();
      time("interactiveMode.init");
      printTimings();
      console.error("PI_STARTUP_BENCHMARK_READY");
      interactiveMode.stop();
      await runtime.dispose();
      stopThemeWatcher();
      if (process.stdout.writableLength > 0) {
        await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
      }
      if (process.stderr.writableLength > 0) {
        await new Promise<void>((resolve) => process.stderr.once("drain", resolve));
      }
      process.exit(0);
    }

    printTimings();
    await interactiveMode.run();
  } else {
    printTimings();
    const exitCode = await runPrintMode(runtime, {
      mode: toPrintOutputMode(appMode),
      messages: parsed.messages,
      initialMessage,
      initialImages,
    });
    stopThemeWatcher();
    restoreStdout();
    process.exit(exitCode);
  }
}
