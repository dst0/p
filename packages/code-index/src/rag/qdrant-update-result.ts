export function assertQdrantUpdateCompleted(result: unknown, operation: string): void {
  const status =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as { status?: unknown }).status
      : undefined;
  if (status !== "completed") {
    throw new Error(
      `Qdrant ${operation} did not complete (status: ${typeof status === "string" ? status : "missing"})`,
    );
  }
}
