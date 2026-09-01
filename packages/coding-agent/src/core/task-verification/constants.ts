import { Type } from "typebox";

export {
  IgnoredSourceClauseSchema,
  IgnoredSourcePromptSchema,
  MAX_REQUIREMENT_COUNT,
  MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
  MAX_REQUIREMENT_REPAIR_ENTRIES,
  MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH,
  MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS,
  REQUIREMENT_TYPES,
  RequirementAuditInputSchema,
  RequirementAuditSchema,
  RequirementDefinitionRepairSchema,
  RequirementDefinitionSchema,
  RequirementTypeSchema,
  RequirementVerdictSchema,
} from "./requirement-audit-schema.ts";

export const TASK_VERIFICATION_TOOL_NAME = "record_task_verification";
export const REQUIREMENT_AUDIT_TOOL_NAME = "record_requirement_audit";

export const USER_FILE_SIZE_OVERRIDE_PATTERN =
  /(?:\b(?:explicitly\s+)?(?:ignore|override|waive|disable)\s+(?:the\s+)?(?:file[- ]size|line(?:-count)?|size)\s+limit\b|\b(?:allow|permit)\s+(?:this\s+task|this\s+file|files?)\s+to\s+(?:exceed|go\s+over)\s+(?:the\s+)?(?:file[- ]size|line(?:-count)?|size)\s+limit\b|\b(?:without|with\s+no)\s+(?:a\s+)?(?:file[- ]size|line(?:-count)?)\s+limit\b|\b(?:do\s+not|don't)\s+split\s+(?:this|the)\s+file\b|(?:явно\s+)?(?:игнорируй|отмени)\s+ограничени[ея]\s+(?:на\s+)?(?:размер|число\s+строк)|без\s+ограничени[яй]\s+(?:на\s+)?(?:размер|число\s+строк)|не\s+разбива(?:й|ть)\s+(?:этот\s+)?файл)/i;
export const USER_FILE_SIZE_OVERRIDE_DENIAL_PATTERN =
  /(?:\b(?:do\s+not|don't|never)\s+(?:explicitly\s+)?(?:ignore|override|waive|disable)\s+(?:the\s+)?(?:file[- ]size|line(?:-count)?|size)\s+limit\b|\b(?:do\s+not|don't|never)\s+(?:allow|permit)\s+(?:this\s+task|this\s+file|files?)\s+to\s+(?:exceed|go\s+over)\s+(?:the\s+)?(?:file[- ]size|line(?:-count)?|size)\s+limit\b|\b(?:revoke|cancel|withdraw)\s+(?:the\s+)?(?:file[- ]size|line(?:-count)?|size)\s+(?:override|exception|waiver)\b|\b(?:enforce|restore|reinstate|respect|keep)\s+(?:the\s+)?(?:normal\s+)?(?:file[- ]size|line(?:-count)?|size)\s+limit\b|(?:не\s+игнорируй|не\s+отменяй|соблюдай|верни)\s+ограничени[ея]\s+(?:на\s+)?(?:размер|число\s+строк)|(?:отзови|отменяю)\s+(?:исключение|разрешение)\s+(?:для\s+)?(?:размера|числа\s+строк))/i;

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

export const TASK_VERIFICATION_REQUIREMENT_SOURCE_CUSTOM_TYPE = "task_verification_requirement_source";

export const TASK_KINDS = ["bug_fix", "behavior_change", "refactor", "feature", "docs", "investigation"] as const;

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

export const EvidenceVerificationSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("record_completion_checklist"),
      Type.Literal("ready_to_finish"),
      Type.Literal("status"),
    ]),
    unresolved_failures: Type.Optional(Type.Array(Type.String())),
    completion_checklist: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 12 }),
    ),
    evidence_refs_by_check: Type.Optional(
      Type.Array(Type.Array(Type.String(), { minItems: 1, maxItems: 8 }), { minItems: 1, maxItems: 12 }),
    ),
  },
  { additionalProperties: false },
);

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
  completion_summary: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 500,
      description: "ready_to_finish only: concise user-visible summary for verified terminal completion.",
    }),
  ),
});

export const KNOWN_EVIDENCE_TOOLS = new Set(["read", "bash", "rg", "grep", "find", "ls", "semantic_search"]);

export const KNOWN_STATIC_TOOLS = new Set(["read", "rg", "grep", "find", "ls", "semantic_search"]);

export const KNOWN_DIRECT_MUTATION_TOOLS = new Set(["edit", "write"]);

export const BUG_PATTERN =
  /\b(bug|fix|broken|regression|incorrect|wrong|failure|lost|crash|race|issue|repair)\b|(?:ошиб|баг|слом|невер|неправ|теря|паден|исправ)/iu;

export const REFACTOR_PATTERN = /\brefactor|restructure|reorganize\b|(?:рефактор|перестро|реорганиз)/iu;

export const DOCS_PATTERN = /\b(?:docs?|documentation|readme|changelog)\b|(?:документ|ридми|чейнджлог)/iu;

export const INVESTIGATION_PATTERN =
  /\b(?:analy[sz]\w*|assess\w*|audit\w*|diagnos\w*|explain\w*|find\s+the\s+cause|inspect\w*|investigat\w*|review\w*|summari[sz]\w*)\b|(?:исслед|диагност|анализ|аудит|объясн|обзор|причин|суммар)/iu;

export const HIGH_RISK_PATTERN =
  /\b(sigterm|sigint|sigkill|signal|shutdown|restart|daemon|crash|recovery|resume|checkpoint|manifest|persist|durab|transaction|concurr|race|deadlock|indexing|refresh|migration)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт|манифест|персист|транзакц|конкурент|гонк|индекс|миграц)/iu;

export const HIGH_RISK_REQUIREMENT_PATTERN =
  /\b(?:access\s+controls?|auth(?:entication|orization)?|authenticate(?:d)?|unauthenticated|authorize|authorized\s+(?:access|actors?|clients?|requests?|users?)|atomic\w*|backoff\w*|clock\w*|command[-\s]?ids?|compensat\w*|concurr\w*|credential\w*|deadlock\w*|deep\s+cop(?:y|ies)|durab\w*|encrypt\w*|event[-\s]?logs?|exact_file_bytes|fenc\w*|hash(?:es|ed|ing)?\b|idempoten\w*|immutab\w*|integrity\w*|lease\w*|manifest\w*|newline[-\s]?terminat\w*|permission\w*|persist\w*|privacy\w*|race\w*|recover\w*|(?:event[-\s]?log|state|command|restore)\s+replay|replay\s+(?:integrity|recovery|validation)|retr(?:y|ies|ied|ying)|reverse[-\s]+order|rollback\w*|schedul\w*|secret\w*|secur\w*|stream\s+versions?|tamper\w*|terminal\s+newlines?|transaction\w*|traversal\w*|truncat\w*|virtual[-\s]+time)\b|(?:атомар|аутентиф|авторизац|безопас|восстанов|гонк|доступ|идемпотент|конкурент|откат|персист|подмен|приват|секрет|транзакц|целостн)/iu;

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
