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
        // 자격검증 시작 시각 — 해시 읽기/ bcrypt 前에 찍는다(아래 token.iatMs 기준). 검증 도중 커밋된 비번변경이
        // 이 시각보다 뒤면 passwordChangedAt > loginAtMs로 이 로그인을 무효화한다(발급시각으로 찍을 때 생기는 race 차단).
        const loginAtMs = Date.now();
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // email은 사용자 병합 키(canonical). write 경로(signup/resend/admin)는 소문자로 저장하지만, 입력을 소문자로
        // 바꿔 exact-match하면 마이그레이션 백필 전 기존 혼합대소문자 행이 매칭되지 않아 로그인이 깨진다(통합리뷰 finding).
        // 대소문자 무시 조회로 저장 케이스와 무관하게 매칭한다 — 케이스만 다른 중복행 미형성은 deploy 시 lower(email) 유니크가 보장(아래 follow-up).
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
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
          loginAtMs, // jwt 콜백이 token.iatMs로 사용(자격검증 시작 시각 = 세션 무효화 race 차단 기준)
        };
      },
    }),
  ],
});
