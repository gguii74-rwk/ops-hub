export class NavigationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationValidationError";
  }
}

export class NavigationConflictError extends Error {
  constructor(message = "처리 중 메뉴가 변경되었습니다. 새로고침 후 다시 시도하세요.") {
    super(message);
    this.name = "NavigationConflictError";
  }
}
