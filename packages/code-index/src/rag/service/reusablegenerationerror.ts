export class ReusableGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReusableGenerationError";
  }
}
