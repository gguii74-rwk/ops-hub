// 세션 무효 판정(순수). session 콜백이 DB 스냅샷을 넘겨 호출하고, task-09가 단위테스트한다.
// 무효 조건: ① status !== "ACTIVE" ② passwordChangedAt / sessionInvalidatedAt 가 토큰 발급(iat) 이후.
// 비교는 strict `>`(같으면 이 세션이 더 최신 → 유효). tokenIat은 초 단위(@auth/core), DB 시각은 ms → iat*1000으로 환산.
export interface SessionSnapshot {
  status: string;
  passwordChangedAt: Date | null;
  sessionInvalidatedAt: Date | null;
}

export function isSessionValid(tokenIat: number, snap: SessionSnapshot): boolean {
  if (snap.status !== "ACTIVE") return false;
  const issuedAtMs = tokenIat * 1000;
  if (snap.passwordChangedAt !== null && snap.passwordChangedAt.getTime() > issuedAtMs) return false;
  if (snap.sessionInvalidatedAt !== null && snap.sessionInvalidatedAt.getTime() > issuedAtMs) return false;
  return true;
}
