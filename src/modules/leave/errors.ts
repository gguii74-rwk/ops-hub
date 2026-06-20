export class LeaveValidationError extends Error {
  constructor(message: string) { super(message); this.name = "LeaveValidationError"; }
}
export class LeaveConflictError extends Error {
  constructor(message: string) { super(message); this.name = "LeaveConflictError"; }
}
