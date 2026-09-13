type MonetaryCostResult = { ok: true; amount: number } | { ok: false; error: string };

export function readMonetaryCost(value: unknown, label: string): MonetaryCostResult {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "object" && value !== null
        ? (value as Record<string, unknown>).total
        : undefined;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: `Invalid ${label} monetary cost` };
  }
  return { ok: true, amount };
}
