// 세션 무효 판정(순수). session 콜백이 DB 스냅샷을 넘겨 호출하고, task-09가 단위테스트한다.
// 무효 조건: ① status !== "ACTIVE" ② passwordChangedAt / sessionInvalidatedAt 가 토큰 발급시각(ms) 이후.
// 비교는 strict `>`(같으면 이 세션이 더 최신 → 유효).
// 발급시각은 **ms 정밀도**(token.iatMs)를 쓴다 — 표준 JWT iat은 초 단위라, 같은 초 내 강제 비번변경 직후 재로그인하면
// 새 토큰 iat(초 절단)이 passwordChangedAt(ms)보다 "과거"로 보여 fresh 세션이 잘못 무효화되는 lockout이 났다(통합리뷰 finding).
// jwt 콜백이 sign-in 시 token.iatMs=Date.now()를 실어, 같은 초에 발급된 토큰도 ms로 구분된다.
export interface SessionSnapshot {
  status: string;
  passwordChangedAt: Date | null;
  sessionInvalidatedAt: Date | null;
}

export function isSessionValid(issuedAtMs: number, snap: SessionSnapshot): boolean {
  if (snap.status !== "ACTIVE") return false;
  if (snap.passwordChangedAt !== null && snap.passwordChangedAt.getTime() > issuedAtMs) return false;
  if (snap.sessionInvalidatedAt !== null && snap.sessionInvalidatedAt.getTime() > issuedAtMs) return false;
  return true;
}
