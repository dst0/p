export type QdrantPayloadSchema = "bool" | "keyword";

export const QDRANT_PAYLOAD_INDEXES: ReadonlyArray<{
  field_name: string;
  field_schema: QdrantPayloadSchema;
}> = [
  { field_name: "repoId", field_schema: "keyword" },
  { field_name: "fileId", field_schema: "keyword" },
  { field_name: "language", field_schema: "keyword" },
  { field_name: "isTest", field_schema: "bool" },
  { field_name: "isGenerated", field_schema: "bool" },
];
