export class StoredPointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredPointError";
  }
}
