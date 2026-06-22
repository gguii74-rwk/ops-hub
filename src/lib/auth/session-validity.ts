// 세션 무효 판정(순수). session 콜백이 DB 스냅샷을 넘겨 호출하고, task-09가 단위테스트한다.
// 무효 조건: ① status !== "ACTIVE" ② passwordChangedAt / sessionInvalidatedAt 가 토큰 발급시각(ms) 이상.
// 비교는 `>=`(revocation 우선): 무효화 시각이 발급시각과 같은 ms면 무효로 본다. 정상 세션은 발급시각이 마지막 변경보다
// 뒤(로그인이 더 최신)라 < 이므로 유효; 동일 ms는 "발급과 동시각에 커밋된 reset/disable" = 동시 무효화이므로 revoke가 옳다.
// 발급시각은 **ms 정밀도**(token.iatMs=authorize의 loginAtMs)를 쓴다 — 표준 JWT iat(초)는 같은 초 토큰을 못 구분해
// 강제 비번변경 직후 재로그인 lockout이 났고, 발급(bcrypt 이후) 시각이면 검증 도중 변경을 추월하는 race가 있었다(통합리뷰 finding).
// 잔여: 동일 ms 미만(클럭 해상도)·다중서버 클럭 스큐는 timestamp로 못 막는다 — 다중서버 배포 시 monotonic sessionVersion이 정답(하드닝 후보).
export interface SessionSnapshot {
  status: string;
  passwordChangedAt: Date | null;
  sessionInvalidatedAt: Date | null;
}

export function isSessionValid(issuedAtMs: number, snap: SessionSnapshot): boolean {
  if (snap.status !== "ACTIVE") return false;
  if (snap.passwordChangedAt !== null && snap.passwordChangedAt.getTime() >= issuedAtMs) return false;
  if (snap.sessionInvalidatedAt !== null && snap.sessionInvalidatedAt.getTime() >= issuedAtMs) return false;
  return true;
}
