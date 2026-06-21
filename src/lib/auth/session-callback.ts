import type { NextAuthConfig } from "next-auth";
import "@/lib/auth/types";
import type { SessionUser, SystemRole, EmploymentType, JobFunction } from "@/lib/auth/types";
import { prisma } from "@/lib/prisma";
import { isSessionValid } from "@/lib/auth/session-validity";

// node 전용 — prisma를 import한다. **Edge 미들웨어(src/middleware.ts)가 쓰는 authConfig(config.ts)와 분리**한다:
// config.ts에 두면 미들웨어 번들이 PrismaClient(@/lib/prisma의 모듈로드 시 인스턴스화)를 Edge 런타임에 끌고 들어가 깨진다.
// 따라서 이 콜백은 서버 NextAuth 인스턴스(src/lib/auth/index.ts)에만 결합한다.
//
// 세션 해석마다 DB를 권위로 재검증·재구성한다(JWT는 무상태라 발급 후 상태변화를 자체로 모름).
// 무효 판정: DB 스냅샷(status/passwordChangedAt/sessionInvalidatedAt)을 순수 헬퍼 isSessionValid에 위임(§S9).
// 유효하면 session.user를 **DB 권위값으로 fresh 재구성**한다(특히 systemRole — stale JWT 신뢰 금지, finding #1).
export const sessionCallback: NonNullable<NextAuthConfig["callbacks"]>["session"] = async ({ session, token }) => {
  const s = session as unknown as { user?: SessionUser; iat?: number };
  const uid = token.uid;
  const current = uid
    ? await prisma.user.findUnique({
        where: { id: uid },
        select: {
          status: true, passwordChangedAt: true, sessionInvalidatedAt: true, mustChangePassword: true,
          systemRole: true, name: true, email: true, employmentType: true, jobFunction: true,
        },
      })
    : null;
  // token.iat은 초 단위(@auth/core 표준). 헬퍼 내부에서 iat*1000으로 환산해 DB 시각(ms)과 비교.
  const issuedAt = typeof token.iat === "number" ? token.iat : 0;
  if (!uid || !current || !isSessionValid(issuedAt, current)) {
    // 무효: prefilled user가 남아 있으면 새어 나가지 않도록 명시적으로 제거(들어온 session 그대로 반환 금지).
    delete s.user;
    return session;
  }
  // DB 권위값으로 재구성 — systemRole/name/email 등 식별·특권 속성을 stale JWT가 아닌 DB에서 가져온다.
  s.user = {
    id: uid,
    email: current.email,
    name: current.name,
    systemRole: current.systemRole as SystemRole,
    employmentType: current.employmentType as EmploymentType,
    jobFunction: current.jobFunction as JobFunction,
    mustChangePassword: current.mustChangePassword, // DB 권위(강제변경 진행 중 해제를 즉시 반영)
  };
  // 검증에 쓴 발급시각을 세션에 실어, 서버 재검증(verifySession)이 동일 기준으로 무효화를 판단(F-FED).
  s.iat = issuedAt;
  return session;
};
