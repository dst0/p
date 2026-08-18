import { Type } from "typebox";

export const TASK_VERIFICATION_TOOL_NAME = "record_task_verification";

export const REQUIREMENT_AUDIT_TOOL_NAME = "record_requirement_audit";

export const MAX_REQUIREMENT_COUNT = 32;

export const USER_FILE_SIZE_OVERRIDE_PATTERN =
  /(?:large|single|huge|big|long)\s+file|ignore\s+(?:file\s+size|line|size)\s+limit|no\s+line\s+limit|allow\s+large|without\s+limit|без\s+ограничений|один\s+файл|большой\s+файл|не\s+разбивать/i;

export const CHECKED_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
]);

export const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "vendor",
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "benchmarks",
  ".gemini",
  ".agents",
]);

export const TASK_VERIFICATION_STATE_CUSTOM_TYPE = "task_verification_state";

export const TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE = "task_verification_evidence";

export const TASK_KINDS = ["bug_fix", "behavior_change", "refactor", "feature", "docs", "investigation"] as const;

export const REQUIREMENT_TYPES = ["behavior", "constraint", "deliverable", "verification", "workflow"] as const;

export const BASELINE_METHODS = ["runtime_reproduction", "failing_regression_test", "static_trace"] as const;

export const FINAL_METHODS = ["focused_test", "test_suite", "manual_reproduction", "static_review"] as const;

export const TaskKindSchema = Type.Union([
  Type.Literal("bug_fix"),
  Type.Literal("behavior_change"),
  Type.Literal("refactor"),
  Type.Literal("feature"),
  Type.Literal("docs"),
  Type.Literal("investigation"),
]);

export const BaselineMethodSchema = Type.Union([
  Type.Literal("runtime_reproduction"),
  Type.Literal("failing_regression_test"),
  Type.Literal("static_trace"),
]);

export const FinalMethodSchema = Type.Union([
  Type.Literal("focused_test"),
  Type.Literal("test_suite"),
  Type.Literal("manual_reproduction"),
  Type.Literal("static_review"),
]);

export const AcceptanceCheckSchema = Type.Object({
  criterion: Type.String({ minLength: 1 }),
  evidence_refs: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
});

export const RequirementTypeSchema = Type.Union([
  Type.Literal("behavior"),
  Type.Literal("constraint"),
  Type.Literal("deliverable"),
  Type.Literal("verification"),
  Type.Literal("workflow"),
]);

export const RequirementDefinitionSchema = Type.Object({
  type: RequirementTypeSchema,
  text: Type.String({ minLength: 1 }),
  acceptance_criterion: Type.String({ minLength: 1 }),
  source_prompt_indexes: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
});

export const IgnoredSourcePromptSchema = Type.Object({
  source_prompt_index: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1 }),
});

export const RequirementAuditSchema = Type.Object({
  action: Type.Union([Type.Literal("define"), Type.Literal("verdict")]),
  requirements: Type.Optional(
    Type.Array(RequirementDefinitionSchema, { minItems: 1, maxItems: MAX_REQUIREMENT_COUNT }),
  ),
  ignored_source_prompts: Type.Optional(Type.Array(IgnoredSourcePromptSchema, { maxItems: 64 })),
  requirement_id: Type.Optional(Type.String()),
  passed: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.String()),
  evidence_refs: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 8 })),
});

export const VerificationSchema = Type.Object({
  action: Type.Union([
    Type.Literal("declare_task"),
    Type.Literal("authorize_baseline_test"),
    Type.Literal("record_baseline"),
    Type.Literal("record_final"),
    Type.Literal("ready_to_finish"),
    Type.Literal("status"),
  ]),
  task_kind: Type.Optional(TaskKindSchema),
  task_summary: Type.Optional(Type.String()),
  test_paths: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 8 })),
  hypothesis: Type.Optional(Type.String()),
  conclusion: Type.Optional(Type.String()),
  baseline_method: Type.Optional(BaselineMethodSchema),
  evidence_refs: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
  unresolved_assumptions: Type.Optional(Type.Array(Type.String())),
  expected_behavior: Type.Optional(Type.String()),
  observed_behavior: Type.Optional(Type.String()),
  final_method: Type.Optional(FinalMethodSchema),
  final_status: Type.Optional(Type.Union([Type.Literal("passed"), Type.Literal("failed")])),
  unresolved_failures: Type.Optional(Type.Array(Type.String())),
  acceptance_checks: Type.Optional(Type.Array(AcceptanceCheckSchema, { minItems: 1, maxItems: 32 })),
});

export const KNOWN_EVIDENCE_TOOLS = new Set(["read", "bash", "rg", "grep", "find", "ls", "semantic_search"]);

export const KNOWN_STATIC_TOOLS = new Set(["read", "rg", "grep", "find", "ls", "semantic_search"]);

export const KNOWN_DIRECT_MUTATION_TOOLS = new Set(["edit", "write"]);

export const BUG_PATTERN =
  /\b(bug|fix|broken|regression|incorrect|wrong|failure|lost|crash|race|issue|repair)\b|(?:ошиб|баг|слом|невер|неправ|теря|паден|исправ)/iu;

export const REFACTOR_PATTERN = /\brefactor|restructure|reorganize\b|(?:рефактор|перестро|реорганиз)/iu;

export const DOCS_PATTERN = /\b(?:docs?|documentation|readme|changelog)\b|(?:документ|ридми|чейнджлог)/iu;

export const INVESTIGATION_PATTERN =
  /\b(?:investigat|diagnos|analy[sz]|audit|explain|find the cause)\b|(?:исслед|диагност|анализ|аудит|объясн|причин)/iu;

export const HIGH_RISK_PATTERN =
  /\b(sigterm|sigint|sigkill|signal|shutdown|restart|daemon|crash|recovery|resume|checkpoint|manifest|persist|durab|transaction|concurr|race|deadlock|indexing|refresh|migration)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт|манифест|персист|транзакц|конкурент|гонк|индекс|миграц)/iu;

export const BASH_MUTATION_PATTERN =
  /(?:^|[;&|]\s*)(?:sed\s+-i|perl\s+-[a-z]*i|patch\b|git\s+(?:apply|am|cherry-pick|merge|rebase|checkout|switch|reset|restore)\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|truncate\b|tee\b|npm\s+(?:install|uninstall|update)\b|pnpm\s+(?:add|remove|install|update)\b|yarn\s+(?:add|remove|install|upgrade)\b|bun\s+(?:add|remove|install|update)\b|cargo\s+(?:add|remove|update)\b|node\s+scripts\/version-bump\.js\b|\.\/reinstall\.sh\b)/iu;

export const WRITE_REDIRECT_PATTERN = /(?:^|[;&|]\s*)(?:echo|printf|cat)\b[^\n;]*(?:>|>>)\s*(?!\/dev\/null\b)/iu;

export const GENERIC_CHECK_PATTERN =
  /(?:^|[;&|]\s*)(?:npm\s+(?:run\s+)?(?:check|typecheck)|pnpm\s+(?:run\s+)?(?:check|typecheck)|yarn\s+(?:run\s+)?(?:check|typecheck)|(?:npx\s+|npm\s+exec\s+)?tsc\b|biome\b|eslint\b|prettier\b|cargo\s+(?:fmt|clippy)\b)/iu;

export const TYPECHECK_PATTERN =
  /(?:^|[;&|]\s*)(?:npm\s+(?:run\s+)?typecheck|pnpm\s+(?:run\s+)?typecheck|yarn\s+(?:run\s+)?typecheck|(?:npx\s+|npm\s+exec\s+)?tsc\b)/iu;

export const READ_ONLY_PATTERN =
  /^\s*(?:pwd\b|ls\b|find\b|fd\b|rg\b|grep\b|cat\b|head\b|tail\b|stat\b|wc\b|md5\b|md5sum\b|shasum\b|sha256sum\b|git\s+(?:status|diff|show|log)\b)/iu;

export const TEST_PATTERN =
  /\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|node\s+--test|bun\s+(?:run\s+)?test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|\.\/test\.sh)\b/iu;

export const FOCUSED_TEST_PATTERN =
  /(?:test\/|tests\/|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|--test-name-pattern\b|\s-t\s+\S+)/iu;

export const TEST_PATH_PATTERN = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu;

export const TEST_REQUEST_PATTERN =
  /\b(?:run|execute|add|write|include|pass|rerun)?\s*(?:the\s+)?(?:focused\s+|full\s+|unit\s+|integration\s+|regression\s+)?tests?\b|(?:запуст|добав|напис|прогон|покр)[^\n.]{0,30}\bтест/iu;

export const TEST_OPT_OUT_PATTERN =
  /\b(?:do not|don't|dont|skip|avoid|without|no need to)\s+(?:run|add|write|execute)?\s*(?:the\s+)?tests?\b|(?:не\s+(?:запуска|добавля|пиши)|без)\w*[^\n.]{0,20}\bтест/iu;

export const TYPECHECK_REQUEST_PATTERN =
  /\b(?:run|pass|rerun)?\s*(?:the\s+)?(?:typecheck|type-check|type check|tsc)\b|(?:проверк\w*\s+тип|тайпчек)/iu;

export const TYPECHECK_OPT_OUT_PATTERN =
  /\b(?:do not|don't|dont|skip|avoid|without|no need to)[^\n.]{0,60}\b(?:typecheck|type-check|type check|tsc)\b|(?:не\s+запуска\w*|без)[^\n.]{0,40}(?:проверк\w*\s+тип|тайпчек)/iu;

export const ACCEPTANCE_SIGNAL_PATTERN =
  /\b(?:exact\w*|every|all|must|never|reject\w*|atomic\w*|rollback\w*|idempoten\w*|truncat\w*|tamper\w*|deep\w*|reverse\w*|monotonic\w*|stale|fenc\w*|persist\w*|recover\w*)\b|(?:точн\w*|кажд\w*|все|весь|долж\w*|никогд\w*|отклон\w*|атомар\w*|откат\w*|идемпотент\w*|обрез\w*|подмен\w*|глубок\w*|обратн\w*|монотон\w*|устар\w*|персист\w*|восстанов\w*)/giu;
