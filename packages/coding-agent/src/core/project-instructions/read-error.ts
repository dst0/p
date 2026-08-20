export class ProjectInstructionReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectInstructionReadError";
  }
}
