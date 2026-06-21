import type { NextAuthConfig } from "next-auth";
import "@/lib/auth/types";
import type { SessionUser, SystemRole, EmploymentType, JobFunction } from "@/lib/auth/types";
import { prisma } from "@/lib/prisma";
import { isSessionValid } from "@/lib/auth/session-validity";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");
      if (isPublic) return true;
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.name = user.name ?? "";
        token.email = user.email ?? "";
        token.systemRole = user.systemRole;
        token.employmentType = user.employmentType;
        token.jobFunction = user.jobFunction;
        token.mustChange = user.mustChangePassword;
        token.status = user.status;
      }
      return token;
    },
    // 세션 해석마다 DB를 권위로 재검증·재구성한다(JWT는 무상태라 발급 후 상태변화를 자체로 모름).
    // 무효 판정: DB 스냅샷(status/passwordChangedAt/sessionInvalidatedAt)을 순수 헬퍼 isSessionValid에 위임(§S9).
    // 유효하면 session.user를 **DB 권위값으로 fresh 재구성**한다(특히 systemRole — stale JWT 신뢰 금지, finding #1).
    async session({ session, token }) {
      const s = session as unknown as { user?: SessionUser };
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
      return session;
    },
  },
};
