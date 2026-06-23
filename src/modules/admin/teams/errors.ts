export class TeamConflictError extends Error {        // 409 — stale CAS / 미존재
  constructor(message = "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.") { super(message); this.name = "TeamConflictError"; }
}
export class TeamInvariantError extends Error {        // 422 — 팀장 불변식 위반
  constructor(message: string) { super(message); this.name = "TeamInvariantError"; }
}
