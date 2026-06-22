import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { issueClaims, type Identity } from "@/lib/auth/federation/claims";
import { isSessionValid } from "@/lib/auth/session-validity";

export { issueClaims, toGroups } from "@/lib/auth/federation/claims";
export type { Identity } from "@/lib/auth/federation/claims";

/**
 * ops-hub 세션이 유효하면 외부용 Identity, 아니면 null.
 * JWT 스냅샷이 아니라 **DB 현재값**으로 claims를 만든다(권한 엔진 loadUserContext와 동일한 fail-closed).
 * access-layer(requirePermission)를 거치지 않는 경로이므로, must-change·세션무효 차단을 여기서도 직접 적용한다(§S9 finding #2):
 *  - mustChangePassword면 federation 헤더/그룹 미발급(권한 게이트와 동일하게 권한 0 취급).
 *  - passwordChangedAt/sessionInvalidatedAt이 세션 발급(iat) 이후면 무효(isSessionValid 공유).
 */
export async function verifySession(): Promise<Identity | null> {
  const session = await auth();
  if (!session?.user) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, email: true, systemRole: true, status: true,
      mustChangePassword: true, passwordChangedAt: true, sessionInvalidatedAt: true,
    },
  });
  if (!user) return null;
  // must-change는 권한 0(중앙 게이트와 동일) → federation 헤더/그룹도 미발급.
  if (user.mustChangePassword) return null;
  // 상태/무효화 시각 판정은 session 콜백과 동일한 순수 헬퍼를 공유한다.
  // F-FED: 발급시각 기준은 session 콜백이 검증에 쓴 ms 발급시각(session.iatMs)을 사용한다.
  // auth()가 user를 돌려준 뒤 이 2차 DB read 사이에 비번변경/무효화가 끼면, Date.now() 기준으론
  // passwordChangedAt이 "과거"라 통과해 무효 토큰에 claims를 발급할 수 있다(TOCTOU). 발급시각 기준이면 차단된다.
  // session.iatMs가 없는 예외 상황에선 보수적으로 현재시각(ms)으로 폴백(미래시각 무효화는 여전히 걸러짐).
  const issuedAtMs = typeof session.iatMs === "number" ? session.iatMs : Date.now();
  if (!isSessionValid(issuedAtMs, user)) return null;
  return issueClaims(user);
}
