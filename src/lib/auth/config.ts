import type { NextAuthConfig } from "next-auth";
import "@/lib/auth/types";

// **Edge-safe**: 이 config는 src/middleware.ts(Edge 런타임)가 그대로 사용하므로 prisma 등 node 전용 모듈을 import하면 안 된다.
// DB 권위 세션 재검증(session 콜백)은 node 전용 src/lib/auth/session-callback.ts에 두고 서버 인스턴스(index.ts)에서만 결합한다.
// 미들웨어는 authorized로 "토큰 존재" 거친 게이트만 본다(세밀한 무효화·권한은 서버 auth()/requirePermission가 강제).
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
    // session 콜백(DB 권위 재검증·재구성)은 node 전용이라 여기 두지 않는다 — src/lib/auth/session-callback.ts 참조.
  },
};
