# Task 07 — 라우트 보호 미들웨어 + federation seam + /api/auth/verify

목적: ① 미인증 접근을 `/login`으로 보내는 edge 미들웨어, ② 외부 연동을 한 곳에 가두는 `lib/auth/federation` 어댑터(A→B 전환 시 여기만 바뀜), ③ forward-auth용 `GET /api/auth/verify`(검증된 `X-Auth-*` 헤더 발급)를 세운다. **실제 리버스 프록시·KGS 매핑은 별도 플랜** — 여기선 ops-hub 측 seam만.

## Files

- Create: `src/middleware.ts`
- Create: `src/lib/auth/federation/claims.ts`
- Create: `src/lib/auth/federation/index.ts`
- Create: `src/app/api/auth/verify/route.ts`
- Create: `tests/lib/auth/federation.test.ts`

## Prep

- §Shared Contracts **SC-7**(federation seam), **SC-6**(SessionUser).
- spec §8(신원 연동 A안, 헤더 스푸핑 차단 2원칙). context7 검증: v5 미들웨어 = `export const { auth } = NextAuth(authConfig); export default auth`.

## Deps

06(auth 인스턴스·authConfig·세션 타입).

## Steps

### 1. edge 미들웨어 — `src/middleware.ts`

edge-safe `authConfig`만 쓰는 별도 인스턴스(Prisma 미포함). `authorized` 콜백이 보호/공개를 판정한다.

```ts
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

export const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // api(자체 인증)·정적 자원은 미들웨어 제외. 나머지 페이지는 authorized 콜백이 판정.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

### 2. 순수 claims 매핑 — `src/lib/auth/federation/claims.ts`

auth/Prisma를 import하지 않는다(순수 → TDD 가능).

```ts
import type { SessionUser } from "@/lib/auth/types";

export interface Identity {
  sub: string;
  email: string;
  groups: string[];
}

/** coarse groups 매핑(spec §8). 모든 인증 사용자 + systemRole별 가산. */
export function toGroups(user: SessionUser): string[] {
  const groups = ["kgs-user"];
  if (user.systemRole === "OWNER" || user.systemRole === "ADMIN") groups.push("ops-admin");
  if (user.systemRole === "MANAGER") groups.push("ops-manager");
  return groups;
}

/** 외부에 넘기는 "최소 신원". 출력 모양(sub/email/groups)이 A→B 전환의 안정 계약. */
export function issueClaims(user: SessionUser): Identity {
  return { sub: user.id, email: user.email, groups: toGroups(user) };
}
```

### 3. federation 진입점 — `src/lib/auth/federation/index.ts`

```ts
import { auth } from "@/lib/auth";
import { issueClaims, type Identity } from "@/lib/auth/federation/claims";

export { issueClaims, toGroups } from "@/lib/auth/federation/claims";
export type { Identity } from "@/lib/auth/federation/claims";

/** ops-hub 세션이 유효하면 외부용 Identity, 아니면 null. */
export async function verifySession(): Promise<Identity | null> {
  const session = await auth();
  if (!session?.user) return null;
  return issueClaims(session.user);
}
```

### 4. forward-auth 엔드포인트 — `src/app/api/auth/verify/route.ts`

프록시가 KGS로 넘기기 전 호출한다. 유효 → 200 + 검증된 헤더, 무효 → 401.

```ts
import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/federation";

export async function GET() {
  const identity = await verifySession();
  if (!identity) {
    return new NextResponse(null, { status: 401 });
  }
  const res = new NextResponse(null, { status: 200 });
  res.headers.set("X-Auth-Sub", identity.sub);
  res.headers.set("X-Auth-Email", identity.email);
  res.headers.set("X-Auth-Groups", identity.groups.join(","));
  return res;
}
```

### 5. [TDD] claims 매핑 테스트 — `tests/lib/auth/federation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { issueClaims, toGroups } from "@/lib/auth/federation/claims";
import type { SessionUser } from "@/lib/auth/types";

const base: SessionUser = {
  id: "u1",
  email: "a@b.com",
  name: "A",
  systemRole: "MEMBER",
  employmentType: "REGULAR",
  jobFunction: "DEVELOPER",
};

describe("federation claims", () => {
  it("every authenticated user gets kgs-user", () => {
    expect(toGroups(base)).toEqual(["kgs-user"]);
  });

  it("OWNER/ADMIN gets ops-admin", () => {
    expect(toGroups({ ...base, systemRole: "OWNER" })).toContain("ops-admin");
    expect(toGroups({ ...base, systemRole: "ADMIN" })).toContain("ops-admin");
  });

  it("MANAGER gets ops-manager", () => {
    expect(toGroups({ ...base, systemRole: "MANAGER" })).toContain("ops-manager");
  });

  it("issueClaims exposes only sub/email/groups", () => {
    expect(issueClaims(base)).toEqual({ sub: "u1", email: "a@b.com", groups: ["kgs-user"] });
  });
});
```

### 6. 검증

```bash
npm test            # federation 4개 통과 + 기존 유지
npm run typecheck   # 에러 0
npm run lint        # 에러 0
npm run build       # 성공
```

미들웨어·verify 스모크(dev 서버):

```bash
npm run dev
curl -sI http://localhost:3000/dashboard          # 미인증 → 307, Location: /login
curl -sI http://localhost:3000/api/auth/verify     # 미인증 → 401
```

(200 + X-Auth-* 헤더 경로는 로그인 세션 쿠키가 있어야 하므로 admin seed된 task-10 AC에서 검증.)

### 7. 커밋

```bash
git add -A
git commit -m "Add route protection middleware, federation seam, forward-auth verify endpoint"
```

## Acceptance Criteria

- `tests/lib/auth/federation.test.ts` 4개 통과.
- 미인증으로 `/dashboard` 요청 시 `/login`으로 307 리다이렉트.
- 미인증으로 `/api/auth/verify` 요청 시 401.
- `verifySession`/`issueClaims`/`toGroups`가 `lib/auth/federation` 한 곳에 격리(외부 import 표면이 여기뿐).
- typecheck/lint/build 에러 0.

## Cautions

- **Don't 미들웨어에서 `@/lib/auth`(index)를 import하지 마라. Reason:** 그건 Credentials+Prisma를 끌어와 edge 번들을 깨뜨린다. 미들웨어는 `authConfig`만 쓰는 별도 `NextAuth(authConfig)` 인스턴스를 만든다.
- **Don't `/api/auth/verify`에서 직접 `auth()`를 부르지 말고 `verifySession()`을 거쳐라. Reason:** A(forward-auth)→B(OIDC) 전환 시 federation 어댑터 한 곳만 바뀌어야 한다. 엔드포인트가 어댑터 출력(Identity)에만 의존하게 유지한다.
- **Don't 클라이언트가 보낸 `X-Auth-*`를 신뢰하는 코드를 ops-hub에 두지 마라. Reason:** 스푸핑 차단은 프록시 책임(별도 플랜)이지만, ops-hub는 항상 세션에서 새로 헤더를 발급할 뿐 들어온 헤더를 읽지 않는다.
