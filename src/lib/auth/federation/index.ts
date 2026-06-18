import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { issueClaims, type Identity } from "@/lib/auth/federation/claims";

export { issueClaims, toGroups } from "@/lib/auth/federation/claims";
export type { Identity } from "@/lib/auth/federation/claims";

/**
 * ops-hub 세션이 유효하면 외부용 Identity, 아니면 null.
 * JWT 스냅샷이 아니라 **DB 현재값**으로 claims를 만든다(권한 엔진 loadUserContext와 동일한 fail-closed):
 * 로그인 후 비활성화(status!==ACTIVE)·삭제·강등이 즉시 반영돼 stale 토큰으로 권한이 새지 않는다.
 */
export async function verifySession(): Promise<Identity | null> {
  const session = await auth();
  if (!session?.user) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, systemRole: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return issueClaims(user);
}
