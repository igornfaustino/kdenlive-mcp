export class ProjectError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

export function requireCondition(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new ProjectError(code, message);
}
