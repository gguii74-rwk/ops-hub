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
  // iat: session 콜백이 이미 무효 세션의 session.user를 비우므로 auth()가 user를 돌려준 시점에서
  // 세션은 발급시각 기준 유효하다. 방어적으로 DB 시각 자체가 "지금" 이후인 경우만 추가로 거른다
  // (시계 역행·재설정 직후 레이스). 발급시각 기준은 현재시각(now)을 사용.
  if (!isSessionValid(Math.floor(Date.now() / 1000), user)) return null;
  return issueClaims(user);
}
