import { Type } from "typebox";

export const MAX_REQUIREMENT_COUNT = 96;
export const MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS = MAX_REQUIREMENT_COUNT;
export const MAX_REQUIREMENT_REPAIR_ENTRIES = 1;
export const MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH = 16;
export const MAX_REQUIREMENT_REPAIR_UNPRODUCTIVE_ATTEMPTS = 3;
export const MAX_REQUIREMENT_REPAIR_STAGNANT_FRESH_DEFINITIONS = 3;

export const REQUIREMENT_TYPES = ["behavior", "constraint", "deliverable", "verification", "workflow"] as const;

export const RequirementTypeSchema = Type.Union([
  Type.Literal("behavior"),
  Type.Literal("constraint"),
  Type.Literal("deliverable"),
  Type.Literal("verification"),
  Type.Literal("workflow"),
]);

export const RequirementDefinitionSchema = Type.Object(
  {
    type: RequirementTypeSchema,
    text: Type.String({ minLength: 1 }),
    acceptance_criterion: Type.String({ minLength: 1 }),
    source_prompt_indexes: Type.Optional(
      Type.Array(Type.Integer({ minimum: 1 }), {
        description:
          "1-based indexes of direct user prompts only; referenced-file provenance uses source_clause_ids or source_facet_ids.",
        minItems: 1,
      }),
    ),
    source_clause_ids: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Referenced-file source clause identifiers; prompt indexes are derived by the controller.",
        minItems: 1,
        maxItems: 128,
      }),
    ),
    source_facet_ids: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Referenced-file source facet identifiers; prompt indexes are derived by the controller.",
        minItems: 1,
        maxItems: 32,
      }),
    ),
  },
  { additionalProperties: false },
);

export const RequirementDefinitionRepairSchema = Type.Object(
  {
    requirement_index: Type.Integer({ minimum: 1, maximum: MAX_REQUIREMENT_COUNT }),
    replacements: Type.Array(RequirementDefinitionSchema, {
      description: `Complete atomic replacements for this one indexed item; a split may contain at most ${MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS} replacements.`,
      maxItems: MAX_REQUIREMENT_REPAIR_BATCH_REPLACEMENTS,
    }),
  },
  { additionalProperties: false },
);

export const IgnoredSourcePromptSchema = Type.Object(
  {
    source_prompt_index: Type.Integer({ minimum: 1 }),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const IgnoredSourceClauseSchema = Type.Object(
  {
    source_clause_id: Type.String({ minLength: 1 }),
    classification: Type.Union([
      Type.Literal("informational"),
      Type.Literal("example"),
      Type.Literal("superseded"),
      Type.Literal("unsafe_instruction"),
    ]),
    reason: Type.String({ minLength: 1 }),
    superseded_by_source_prompt_index: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const RequirementVerdictSchema = Type.Object(
  {
    requirement_id: Type.String({ minLength: 1 }),
    passed: Type.Boolean(),
    reason: Type.String({ minLength: 1 }),
    evidence_refs: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 8 })),
  },
  { additionalProperties: false },
);

const prepareDefinitionFields = {
  selected_paths: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
      description: "prepare_definition only: 0-3 authoritative requirement-source paths.",
      maxItems: 3,
    }),
  ),
  adopt_changed_paths: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 3, uniqueItems: true }),
  ),
  ignored_paths: Type.Optional(
    Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 240 }),
          reason: Type.String({ minLength: 1, maxLength: 500 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 8 },
    ),
  ),
};

const definitionFields = {
  requirements: Type.Optional(
    Type.Array(RequirementDefinitionSchema, {
      description: "define only: the complete atomic requirement set.",
      minItems: 1,
      maxItems: MAX_REQUIREMENT_COUNT,
    }),
  ),
  ignored_source_prompts: Type.Optional(
    Type.Array(IgnoredSourcePromptSchema, {
      description: "define only: complete prompt-classification snapshot.",
      maxItems: 64,
    }),
  ),
  ignored_source_clauses: Type.Optional(
    Type.Array(IgnoredSourceClauseSchema, {
      description: "define only: complete clause-classification snapshot.",
      maxItems: 128,
    }),
  ),
};

const repairFields = {
  definition_revision: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  requirement_repairs: Type.Optional(
    Type.Array(RequirementDefinitionRepairSchema, {
      description: `Exactly one indexed item correction; lineage growth beyond ${MAX_REQUIREMENT_REPAIR_LINEAGE_GROWTH} requirements requires a fresh define batch.`,
      minItems: 1,
      maxItems: MAX_REQUIREMENT_REPAIR_ENTRIES,
    }),
  ),
  ignored_source_prompt_upserts: Type.Optional(Type.Array(IgnoredSourcePromptSchema, { minItems: 1, maxItems: 1 })),
  ignored_source_prompt_removals: Type.Optional(
    Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 1, uniqueItems: true }),
  ),
  ignored_source_clause_upserts: Type.Optional(Type.Array(IgnoredSourceClauseSchema, { minItems: 1, maxItems: 1 })),
  ignored_source_clause_removals: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 1, uniqueItems: true }),
  ),
};

const verdictFields = {
  verdicts: Type.Optional(Type.Array(RequirementVerdictSchema, { minItems: 1, maxItems: MAX_REQUIREMENT_COUNT })),
};

export const RequirementAuditInputSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("prepare_definition"),
      Type.Literal("define"),
      Type.Literal("repair_definition"),
      Type.Literal("verdict"),
    ]),
    ...prepareDefinitionFields,
    ...definitionFields,
    ...repairFields,
    ...verdictFields,
  },
  { additionalProperties: false },
);

// Providers require a root object schema; execute-time guards enforce the action-specific field subsets.
export const RequirementAuditSchema = RequirementAuditInputSchema;
