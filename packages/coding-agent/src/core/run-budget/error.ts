export class RunBudgetError extends Error {
  readonly code: "budget_exhausted" | "budget_uncertain" | "budget_pricing_required" | "budget_storage_error";

  constructor(code: RunBudgetError["code"], message: string) {
    super(`${code}: ${message}`);
    this.name = "RunBudgetError";
    this.code = code;
  }
}
