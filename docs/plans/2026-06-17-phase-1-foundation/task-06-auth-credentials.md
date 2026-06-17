# Task 06 — NextAuth v5 Credentials + 세션 + 로그인

목적: 단일 출처 인증을 세운다 — NextAuth v5(JWT 세션) Credentials provider로 이메일+비밀번호 로그인, 세션엔 coarse 정보만(SC-6), edge-safe 설정 분리로 미들웨어(task-07)가 Prisma를 번들하지 않게 한다.

## Files

- Create: `src/lib/auth/types.ts`
- Create: `src/lib/auth/config.ts`
- Create: `src/lib/auth/index.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/login/page.tsx`

## Prep

- §Shared Contracts **SC-6**(세션/사용자 형태), **SC-8**(prisma), **SC-10**(검증).
- `.env`의 `NEXTAUTH_SECRET`(≥32자), `NEXTAUTH_URL`. NextAuth v5는 `AUTH_*`를 선호하므로 config에 명시적 `secret`으로 브리지한다.
- context7 검증 결과: v5는 `auth.ts`에서 `export const { handlers, auth, signIn, signOut } = NextAuth(config)`; 라우트는 `app/api/auth/[...nextauth]/route.ts`에서 `export const { GET, POST } = handlers`.

## Deps

03(prisma client·User 타입).

## Steps

### 1. 세션 타입 보강 — `src/lib/auth/types.ts`

edge에서도 import되므로 `@prisma/client`를 import하지 않는다(리터럴 유니온 사용, SC-6).

```ts
export type SystemRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
export type EmploymentType = "REGULAR" | "CONTRACTOR";
export type JobFunction = "PM" | "DEVELOPER" | "CONTENT_MANAGER" | "CIVIL_RESPONSE";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  systemRole: SystemRole;
  employmentType: EmploymentType;
  jobFunction: JobFunction;
}

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
  interface User {
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
  }
}
```

### 2. edge-safe 설정 — `src/lib/auth/config.ts`

Prisma 의존 없는 콜백·페이지만. provider는 비워 둔다(index.ts에서 주입).

```ts
import type { NextAuthConfig } from "next-auth";
import "@/lib/auth/types";

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
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.uid,
        email: token.email as string,
        name: token.name as string,
        systemRole: token.systemRole,
        employmentType: token.employmentType,
        jobFunction: token.jobFunction,
      };
      return session;
    },
  },
};
```

### 3. 풀 인증 인스턴스 — `src/lib/auth/index.ts`

Credentials provider는 여기서만(Prisma·bcrypt 의존 → node 런타임).

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth/config";

const credentialsSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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

        const user = await prisma.user.findUnique({ where: { email } });
        // 허용목록(fail-closed): ACTIVE만 통과. INVITED(미활성)·DISABLED는 거부.
        if (!user || user.status !== "ACTIVE") return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          systemRole: user.systemRole,
          employmentType: user.employmentType,
          jobFunction: user.jobFunction,
        };
      },
    }),
  ],
});
```

### 4. 라우트 핸들러 — `src/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

### 5. 로그인 페이지 — `src/app/login/page.tsx`

server action으로 `signIn` 호출. `signIn`의 redirect는 `AuthError`가 아니므로 rethrow한다.

```tsx
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/dashboard",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=invalid");
      }
      throw err; // NEXT_REDIRECT 등은 그대로 던져 Next가 처리
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: 24 }}>
      <h1>ops-hub 로그인</h1>
      {error ? (
        <p style={{ color: "#b91c1c" }}>이메일 또는 비밀번호가 올바르지 않습니다.</p>
      ) : null}
      <form action={login} style={{ display: "grid", gap: 12 }}>
        <label>
          이메일
          <input name="email" type="email" required autoComplete="username" style={{ width: "100%" }} />
        </label>
        <label>
          비밀번호
          <input name="password" type="password" required autoComplete="current-password" style={{ width: "100%" }} />
        </label>
        <button type="submit">로그인</button>
      </form>
    </main>
  );
}
```

### 6. 검증

```bash
npm run typecheck   # 세션 보강 타입 반영, 에러 0
npm run lint        # 에러 0
npm run build       # 성공
```

배선 스모크(DB·시크릿 설정 후, dev 서버):

```bash
npm run dev
# 다른 터미널:
curl -s http://localhost:3000/api/auth/session   # 미로그인 → 빈 객체/null
curl -s http://localhost:3000/api/auth/providers # credentials provider가 보임
```

`/login` 페이지가 200으로 렌더되는지 확인. (실제 로그인 성공 흐름은 admin이 seed된 task-10 AC에서 검증.)

### 7. 커밋

```bash
git add -A
git commit -m "Add NextAuth v5 Credentials auth, session shape, login page"
```

## Acceptance Criteria

- `npm run typecheck`/`lint`/`build` 에러 0.
- `/api/auth/session`이 응답하고, `/api/auth/providers`에 `credentials`가 보인다.
- `/login`이 렌더된다.
- `ACTIVE` 사용자만 인증된다 — `INVITED`/`DISABLED`는 `authorize`가 null을 반환해 로그인 불가.
- 세션은 `id/email/name/systemRole/employmentType/jobFunction`만 담는다(권한 목록 없음).

## Cautions

- **Don't 사용자 상태를 거부목록으로 검사하지 마라. Reason:** `status === "DISABLED"`만 막으면 `INVITED`(초대됐으나 미활성) 계정이 passwordHash로 통과해 세션을 받는다. `status !== "ACTIVE"` 허용목록(fail-closed)으로 ACTIVE만 통과시킨다.
- **Don't Credentials provider를 `config.ts`에 넣지 마라. Reason:** `config.ts`는 미들웨어(edge)가 import한다. authorize가 Prisma를 import하면 edge 번들에 Prisma가 들어가 런타임 에러가 난다. provider는 `index.ts`에만.
- **Don't `signIn`의 throw를 전부 삼키지 마라. Reason:** `redirectTo`가 던지는 `NEXT_REDIRECT`는 정상 동작이다. `AuthError`만 잡고 나머지는 rethrow해야 리다이렉트가 작동한다.
- **Don't `AUTH_SECRET`이 없다고 가정하지 마라. Reason:** `.env`는 `NEXTAUTH_SECRET`을 쓴다. config의 `secret: NEXTAUTH_SECRET ?? AUTH_SECRET`이 양쪽을 잇는다. 시크릿이 비면 v5가 부팅을 거부한다.
- **Don't zod v4에서 `.email()` 같은 포맷 메서드를 가정하지 마라. Reason:** v4는 일부 포맷 API를 top-level(`z.email()`)로 옮겼다. 여기선 `min(1)`만 쓰고 실제 검증은 DB 조회가 한다 — 버전 의존을 피한다.
