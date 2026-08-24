export class LearningError extends Error {
  constructor(message, code = "LEARNING_ERROR") {
    super(message);
    this.name = "LearningError";
    this.code = code;
  }
}

export function requireText(value, name, { minLength = 1 } = {}) {
  if (typeof value !== "string" || value.trim().length < minLength) {
    throw new LearningError(`${name} is required`, "INVALID_INPUT");
  }
  return value.trim();
}
