import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth/config";
import { sessionCallback } from "@/lib/auth/session-callback";

const credentialsSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // node 전용 session 콜백을 서버 인스턴스에만 결합(Edge 미들웨어는 edge-safe authConfig만 사용).
  callbacks: { ...authConfig.callbacks, session: sessionCallback },
  providers: [
    Credentials({
      credentials: {
        email: { label: "이메일", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // email은 사용자 병합 키(canonical). signup/resend/admin 생성이 모두 소문자로 저장하므로 조회도 소문자 정규화한다.
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        // 허용목록(fail-closed): ACTIVE만 통과. INVITED(미활성)·DISABLED는 거부.
        if (!user || user.status !== "ACTIVE") return null;

        // TypeScript narrowing: passwordHash is nullable after the account-lifecycle migration. Unreachable in practice — the status check above already blocks any non-ACTIVE (incl. PENDING/null-hash) user.
        if (!user.passwordHash) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          systemRole: user.systemRole,
          employmentType: user.employmentType,
          jobFunction: user.jobFunction,
          mustChangePassword: user.mustChangePassword,
          status: user.status,
        };
      },
    }),
  ],
});
