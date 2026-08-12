/**
 * Base class for domain/application errors. Subclasses carry a stable `name`
 * that the backend maps to an HTTP status code in `middleware.ts`.
 */
export class CustomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends CustomError {}

export class ForbiddenError extends CustomError {}

export class ValidationError extends CustomError {}
