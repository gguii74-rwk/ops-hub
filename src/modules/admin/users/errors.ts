// admin/users 도메인 에러. 라우트 매핑(entrypoint §S4):
// ForbiddenError/EscalationError→403, UserConflictError/MinAvailabilityError→409,
// UserValidationError/TokenError→400, RateLimitError→429.

export class UserConflictError extends Error {
  constructor(message: string) { super(message); this.name = "UserConflictError"; }
}
export class UserValidationError extends Error {
  constructor(message: string) { super(message); this.name = "UserValidationError"; }
}
export class EscalationError extends Error {
  constructor(message: string) { super(message); this.name = "EscalationError"; }
}
export class MinAvailabilityError extends Error {
  constructor(message: string) { super(message); this.name = "MinAvailabilityError"; }
}
export class RateLimitError extends Error {
  constructor(message: string) { super(message); this.name = "RateLimitError"; }
}
export class TokenError extends Error {
  constructor(message: string) { super(message); this.name = "TokenError"; }
}
