import "server-only";

// ── S10 공유 상수 (D16 토큰 만료 + D18 레이트리밋) ──
export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일 — set-password 겸 검증 토큰 만료(D16)
export const SIGNUP_IP_LIMIT = 10;            // per-IP 윈도우당 가입 시도
export const SIGNUP_EMAIL_LIMIT = 3;          // per-email 윈도우당 가입 시도
export const RESEND_COOLDOWN_MS = 60 * 1000;  // 재발송 쿨다운(per-email)
export const RATE_WINDOW_MS = 60 * 60 * 1000; // 레이트 윈도우 1시간
export const PENDING_UNVERIFIED_CAP = 200;    // 미처리 미검증 PENDING 전역 상한(bounded creation — task-03 createPendingSignup에서 트랜잭션 내 강제)
