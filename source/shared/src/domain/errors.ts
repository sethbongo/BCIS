/** Raised when a business rule is violated. The API maps it to an HTTP 409/422 with a readable message. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
