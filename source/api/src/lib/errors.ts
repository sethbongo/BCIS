/** An error with a safe, user-readable message and an HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} was not found.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const invalid = (message: string, fields?: Record<string, string>) => new AppError(422, 'INVALID_OPERATION', message, fields);
export const forbidden = (message = 'You do not have permission to perform this action.') => new AppError(403, 'FORBIDDEN', message);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);

/** Friendly messages for database constraint violations that can be triggered by normal use. */
export const CONSTRAINT_MESSAGES: Record<string, string> = {
  users_username_unique: 'That username is already taken.',
  service_plans_code_unique: 'A plan with that code already exists.',
  collection_areas_code_unique: 'An area with that code already exists.',
  collectors_code_unique: 'A collector with that code already exists.',
  invoices_account_period_uq: 'This service account already has an invoice for that billing period.',
  payments_gcash_reference_uq: 'A posted payment already uses this GCash reference number.',
  payments_idempotency_key_unique: 'This payment was already posted.',
  payment_reversals_payment_id_unique: 'This payment has already been reversed.',
  collector_assignments_active_uq: 'The collector is already assigned to that area.',
};
