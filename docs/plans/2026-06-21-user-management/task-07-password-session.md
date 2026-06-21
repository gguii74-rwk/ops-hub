# Task 07 — 비번변경 · 세션무효화 · mustChangePassword 중앙게이트 · auth 콜백

**Purpose:** 비밀번호 자가/강제 변경(`POST /api/auth/change-password`, D15)을 구현하고, JWT 세션을 **DB 권위 상태로 재검증**(비활성화·비번변경·재설정 → 기존 세션 무효화)하며, `mustChangePassword` 하드 게이트(D17)를 **권한 계층 단일 지점**(`getPermissionSummary`/`requirePermission`/`hasPermission`)에 fail-closed로 박는다. UI 리다이렉트가 아니라 API/권한 계층이 거부한다.

또한 적대검증 finding 2건을 반영한다: **(finding #1)** session 콜백이 `session.user`를 **DB 권위값으로 fresh 재구성**한다(특히 `systemRole` — stale JWT를 신뢰하면 강등된 OWNER가 task-05 anti-escalation을 우회) + 무효 세션은 `session.user`를 **명시적으로 제거**. **(finding #2)** access-layer(`requirePermission`)를 거치지 않는 federation 경로(`/api/auth/verify`의 `verifySession`)도 **공유 세션 해석**(`isSessionValid` + must-change)으로 일원화해, must-change·세션무효 사용자가 federation 헤더/그룹을 받지 못하게 한다.

## Files
- Modify: `src/lib/auth/types.ts` — `SessionUser`에 `mustChangePassword: boolean`, JWT 선언에 `mustChange`/`status`/`iat` 필드
- Create: `src/lib/auth/session-validity.ts` — 순수 헬퍼 `isSessionValid(tokenIat, snap)`(세션 무효 판정; entrypoint §S9 확정)
- Modify: `src/lib/auth/config.ts` — `jwt` 콜백(발급 클레임 저장) + `session` 콜백(**DB 권위값으로 `session.user` fresh 재구성** + `isSessionValid` 무효 시 `session.user` 제거; finding #1)
- Modify: `src/lib/auth/federation/index.ts` — `verifySession`이 access-layer를 거치지 않는 federation 경로의 **공유 세션 해석 계층**이 되도록 `isSessionValid`(상태/iat) + must-change 차단을 적용(finding #2). 기존 `status !== "ACTIVE"` ad-hoc 검사를 동일 헬퍼로 일원화.
- Modify: `src/kernel/access/index.ts` — `loadUserContext`에 `mustChangePassword`·게이트 헬퍼, `hasPermission`/`getPermissionSummary`/`requirePermission`를 must-change면 fail-closed
- Create: `src/app/api/auth/change-password/route.ts` — `POST` 본인 비번변경(자발/강제), zod, `changePasswordTx`(S6) 호출
- Create: `src/modules/admin/users/validations/change-password.ts` — `changePasswordSchema`(task-04 validations/index 머지 전까지의 로컬 정의 — Divergence 참조)
- Create: `tests/lib/auth/session-validity.test.ts` — 순수 헬퍼 `isSessionValid` 단위(iat 비교 경계; task-09도 이 헬퍼를 검증)
- Create: `tests/lib/auth/session-invalidation.test.ts` — jwt/session 콜백 단위(DB 권위값 fresh 재구성→`isSessionValid` 위임; **stale JWT systemRole이 DB 강등을 못 덮어씀** 검증)
- Modify: `tests/lib/auth/federation.test.ts` — must-change·세션무효 사용자의 `verifySession`이 null(federation 헤더/그룹 미발급) 검증 추가(finding #2)
- Create: `tests/kernel/access/must-change-gate.test.ts` — 중앙 게이트(빈 summary·requirePermission 거부)
- Create: `tests/app/api/auth/change-password.test.ts` — 라우트(자발/강제·현재 비번 검증·플래그 해제)

## Prep
- entrypoint **§Shared Contracts S9**(세션 무효화 + 중앙 게이트 — 이 task가 구현). §S9 확정: 세션 무효 판정은 **순수 헬퍼 `isSessionValid(tokenIat: number, snap: {status, passwordChangedAt, sessionInvalidatedAt}): boolean`**(`src/lib/auth/session-validity.ts`, 이 task가 export)로 분리하고 session 콜백과 **federation `verifySession`이 공유 호출**한다. task-09가 이 헬퍼를 단위테스트한다. §S9 확정 — **session 콜백은 `session.user`를 stale JWT가 아니라 DB 권위값으로 fresh 재구성**(특히 `systemRole`; ActorContext.isOwner의 권위원이라 stale JWT를 신뢰하면 강등된 OWNER가 anti-escalation을 우회한다)하고, 무효면 `session.user`를 **명시적으로 제거**한다. **S6**(`changePasswordTx(id, passwordHash, now)` — task-03이 구현, 여기선 import·호출만).
- **federation 경로(access-layer 미경유)**: `src/app/api/auth/verify/route.ts`(GET)는 `requirePermission`/`getPermissionSummary`가 아니라 `verifySession`(`src/lib/auth/federation/index.ts`)을 통해 `X-Auth-*` 헤더·그룹을 발급한다. 현재 `verifySession`은 `status !== "ACTIVE"`만 거르고 **must-change·iat 무효화는 거르지 않는다** → must-change/비번변경 사용자가 여전히 federation 헤더를 받을 수 있다(finding #2). 이 task가 `verifySession`을 공유 세션 해석(`isSessionValid` + must-change)으로 일원화한다.
- spec **§5**(로그인/비번변경·재설정/비활성화 세션무효화 전이), **§6**(`mustChangePassword` 게이트), **D15**(현재 비번 확인·세션무효화), **D17**(하드 게이트·중앙 단일 가드), **D14**(reset가 `sessionInvalidatedAt`·`mustChangePassword` 세팅 — 이 task의 콜백이 소비).
- 패턴 참조(인라인됨, 재읽기 불필요):
  - 라우트: `src/app/api/leave/requests/route.ts`(session→zod→`requirePermission`→service→`mapError`).
  - 권한 엔진: `src/kernel/access/index.ts`의 `loadUserContext`/`hasPermission`/`getPermissionSummary`/`requirePermission`(보강 대상 — 아래 전체 코드 인라인).
  - auth: `src/lib/auth/index.ts`(`authorize` — ACTIVE만·bcrypt), `src/lib/auth/config.ts`(jwt/session 콜백 — 현재 session은 token만으로 user 재구성, DB 재검사 없음).
  - federation: `src/lib/auth/federation/index.ts`(`verifySession` — `auth()` 세션 → DB `findUnique({status,systemRole,email,id})` → `status==="ACTIVE"`면 `issueClaims`; **must-change·iat 무효화 미검사**), `src/lib/auth/federation/claims.ts`(`issueClaims`/`toGroups`). 보강 대상은 `verifySession` 한 곳 — `claims.ts`·라우트 핸들러는 변경 불필요.
  - bcrypt 비교/해시: `src/lib/auth/index.ts`의 `bcrypt.compare`. 해시 cost는 시드(`bcrypt.hash(pw, 10)`) 관례.
- **인증 모킹**: prisma는 `vi.mock("@/lib/prisma")`, repository는 `vi.mock("@/modules/admin/users/repositories")`, bcrypt는 `vi.mock("bcryptjs")`. `tests/modules/leave/repositories.test.ts`의 `vi.hoisted` fake-db 패턴 동형.

## Deps
- **01** (스키마: `User.mustChangePassword`·`passwordChangedAt`·`sessionInvalidatedAt`·`status`).
- **03** (`changePasswordTx`·`UserConflictError` — `src/modules/admin/users/repositories`·`errors`).

> 03 이후 task-06과 병렬 가능(entrypoint Task 테이블). task-04(service/validations)에는 의존하지 않으므로 `changePasswordSchema`를 **로컬 파일**로 둔다(Divergence 참조).

## Steps

### 1. 실패 테스트 — 순수 헬퍼 `isSessionValid`

`tests/lib/auth/session-validity.test.ts`. **§S9 확정**: 세션 무효 판정은 순수 함수로 분리한다(prisma·NextAuth 비의존). iat 비교 경계를 직접 검증한다. task-09도 이 헬퍼를 단위테스트한다.

```ts
import { describe, it, expect } from "vitest";
import { isSessionValid } from "@/lib/auth/session-validity";

const ISSUED = Math.floor(new Date("2026-06-10T00:00:00Z").getTime() / 1000); // token.iat(초)

describe("isSessionValid — 세션 무효 판정(순수)", () => {
  it("ACTIVE·무효화 시각 없음 → 유효", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: null })).toBe(true);
  });
  it("status가 DISABLED면 무효", () => {
    expect(isSessionValid(ISSUED, { status: "DISABLED", passwordChangedAt: null, sessionInvalidatedAt: null })).toBe(false);
  });
  it("passwordChangedAt이 iat 이후면 무효(비번변경 타 세션 무효화)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-11T00:00:00Z"), sessionInvalidatedAt: null })).toBe(false);
  });
  it("sessionInvalidatedAt이 iat 이후면 무효(비활성화/재설정)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: new Date("2026-06-11T00:00:00Z") })).toBe(false);
  });
  it("무효화 시각이 모두 iat 이전이면 유효(이 세션이 더 최신)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-09T00:00:00Z"), sessionInvalidatedAt: new Date("2026-06-09T00:00:00Z") })).toBe(true);
  });
  it("무효화 시각이 iat과 정확히 같으면 유효(strict `>`)", () => {
    expect(isSessionValid(ISSUED, { status: "ACTIVE", passwordChangedAt: new Date("2026-06-10T00:00:00Z"), sessionInvalidatedAt: null })).toBe(true);
  });
});
```

```
npm test -- tests/lib/auth/session-validity   # expect FAIL (헬퍼 미존재)
```

### 2. 최소 구현 — 순수 헬퍼 `isSessionValid`

`src/lib/auth/session-validity.ts`. **§S9 확정 시그니처 그대로**. status 허용목록(ACTIVE) + iat 비교(strict `>`)만 담은 순수 함수. prisma·NextAuth 비의존이라 session 콜백·task-09가 공유 호출한다.

```ts
// 세션 무효 판정(순수). session 콜백이 DB 스냅샷을 넘겨 호출하고, task-09가 단위테스트한다.
// 무효 조건: ① status !== "ACTIVE" ② passwordChangedAt / sessionInvalidatedAt 가 토큰 발급(iat) 이후.
// 비교는 strict `>`(같으면 이 세션이 더 최신 → 유효). tokenIat은 초 단위(@auth/core), DB 시각은 ms → iat*1000으로 환산.
export interface SessionSnapshot {
  status: string;
  passwordChangedAt: Date | null;
  sessionInvalidatedAt: Date | null;
}

export function isSessionValid(tokenIat: number, snap: SessionSnapshot): boolean {
  if (snap.status !== "ACTIVE") return false;
  const issuedAtMs = tokenIat * 1000;
  if (snap.passwordChangedAt !== null && snap.passwordChangedAt.getTime() > issuedAtMs) return false;
  if (snap.sessionInvalidatedAt !== null && snap.sessionInvalidatedAt.getTime() > issuedAtMs) return false;
  return true;
}
```

```
npm test -- tests/lib/auth/session-validity   # expect PASS
```

### 3. 실패 테스트 — types·session-invalidation 콜백

`tests/lib/auth/session-invalidation.test.ts`. 콜백을 `config.ts`에서 직접 import해 호출(NextAuth 부트스트랩 없이 순수 함수 단위 검증). session 콜백이 **DB 권위값으로 `session.user`를 fresh 재구성**하고(특히 `systemRole`을 stale JWT에서 가져오지 않음 — finding #1) DB 스냅샷을 `isSessionValid`(step 2)에 위임함을 외부 동작으로 검증한다(무효면 `session.user` **제거**). DB 조회 mock은 권위 필드(`systemRole`/`name`/`email`/`employmentType`/`jobFunction`)와 무효화 필드를 함께 반환해야 한다. prisma만 모킹.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = { user: { findUnique: vi.fn() } };
  return { db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { authConfig } from "@/lib/auth/config";

// 콜백 핸들 추출(NextAuthConfig.callbacks).
const jwtCb = authConfig.callbacks!.jwt as (a: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown>> | Record<string, unknown>;
const sessionCb = authConfig.callbacks!.session as (a: { session: Record<string, unknown>; token: Record<string, unknown> }) => Promise<Record<string, unknown>> | Record<string, unknown>;

const ISSUED = Math.floor(new Date("2026-06-10T00:00:00Z").getTime() / 1000); // token.iat(초)
const baseToken = () => ({
  uid: "u1", name: "n", email: "e@x.com",
  systemRole: "MEMBER", employmentType: "REGULAR", jobFunction: "DEVELOPER",
  mustChange: false, status: "ACTIVE", iat: ISSUED,
});
// DB 권위 스냅샷(유효·ACTIVE). 콜백은 이 값으로 session.user를 fresh 재구성한다.
const dbActive = (over: Record<string, unknown> = {}) => ({
  status: "ACTIVE", passwordChangedAt: null, sessionInvalidatedAt: null, mustChangePassword: false,
  systemRole: "MEMBER", name: "n", email: "e@x.com", employmentType: "REGULAR", jobFunction: "DEVELOPER",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("jwt 콜백 — 로그인 시 클레임 저장", () => {
  it("user가 있으면 mustChange/status/식별 클레임을 토큰에 저장", async () => {
    const token = await jwtCb({
      token: {},
      user: { id: "u1", name: "n", email: "e@x.com", systemRole: "MEMBER", employmentType: "REGULAR", jobFunction: "DEVELOPER", mustChangePassword: true, status: "ACTIVE" },
    });
    expect(token.uid).toBe("u1");
    expect(token.mustChange).toBe(true);
    expect(token.status).toBe("ACTIVE");
  });
  it("user가 없으면(후속 호출) 토큰을 보존만 한다", async () => {
    const prev = baseToken();
    const token = await jwtCb({ token: { ...prev } });
    expect(token.uid).toBe("u1");
    expect(token.mustChange).toBe(false);
  });
});

describe("session 콜백 — DB 권위 재구성·재검증(세션 무효화)", () => {
  it("DB가 ACTIVE·무효화 시각 없음 → 세션 user 채움(현재 mustChangePassword 반영)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive());
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: { id: string } }).user?.id).toBe("u1");
    expect((session as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(false);
  });
  it("session.user.systemRole은 DB 권위값으로 재구성(stale JWT가 OWNER여도 DB가 MEMBER면 MEMBER)", async () => {
    // JWT는 강등 전 OWNER 스냅샷을 보유. DB는 강등 후 MEMBER. anti-escalation은 DB systemRole만 신뢰해야 한다(finding #1).
    h.db.user.findUnique.mockResolvedValue(dbActive({ systemRole: "MEMBER" }));
    const session = await sessionCb({ session: {}, token: { ...baseToken(), systemRole: "OWNER" } });
    expect((session as { user: { systemRole: string } }).user.systemRole).toBe("MEMBER");
  });
  it("name/email도 DB 권위값으로 재구성(stale JWT 식별정보 무시)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ name: "새이름", email: "fresh@x.com" }));
    const session = await sessionCb({ session: {}, token: { ...baseToken(), name: "옛이름", email: "stale@x.com" } });
    expect((session as { user: { name: string; email: string } }).user.name).toBe("새이름");
    expect((session as { user: { name: string; email: string } }).user.email).toBe("fresh@x.com");
  });
  it("DB status가 DISABLED면 세션 무효(user 미설정)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ status: "DISABLED" }));
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("무효 세션이면 prefilled session.user도 제거(들어온 user를 그대로 반환 금지 — finding #1)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ status: "DISABLED" }));
    // NextAuth가 이미 채워 넣은 user가 있어도 무효면 명시적으로 비워야 한다.
    const session = await sessionCb({ session: { user: { id: "u1", systemRole: "OWNER" } }, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("passwordChangedAt이 token.iat 이후면 세션 무효(비번변경으로 타 세션 무효화)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ passwordChangedAt: new Date("2026-06-11T00:00:00Z") })); // iat(06-10) 이후
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("sessionInvalidatedAt이 token.iat 이후면 세션 무효(비활성화/재설정)", async () => {
    h.db.user.findUnique.mockResolvedValue(dbActive({ sessionInvalidatedAt: new Date("2026-06-11T00:00:00Z") }));
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
  it("무효화 시각이 token.iat 이전이면 유효(세션 유지)", async () => {
    // iat(06-10) 이전 → 이 세션이 더 최신. 강제변경 필요 상태도 세션은 살아 있음(게이트가 따로 막음).
    h.db.user.findUnique.mockResolvedValue(dbActive({ passwordChangedAt: new Date("2026-06-09T00:00:00Z"), mustChangePassword: true }));
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);
  });
  it("DB에 사용자가 없으면 세션 무효", async () => {
    h.db.user.findUnique.mockResolvedValue(null);
    const session = await sessionCb({ session: {}, token: baseToken() });
    expect((session as { user?: unknown }).user).toBeUndefined();
  });
});
```

```
npm test -- tests/lib/auth/session-invalidation   # expect FAIL (DB 권위 재구성·isSessionValid 위임 미구현)
```

### 4. 최소 구현 — types.ts (SessionUser·JWT 보강)

`src/lib/auth/types.ts`. 기존 필드를 보존하며 `mustChangePassword`(SessionUser)와 발급 클레임(JWT)을 추가한다. **기존 선언·주석은 그대로**, 추가만:

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
  mustChangePassword: boolean; // 신규(D17) — UI가 강제변경 진입에 사용. API 차단은 권한 게이트가 별도로 수행.
}

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
  interface User {
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
    mustChangePassword: boolean; // 신규 — authorize가 반환(아래 step 6)
    status: string;             // 신규 — authorize가 반환(로그인 시점 status; 세션 재검증은 DB가 권위)
  }
}

// next-auth/jwt re-exports the JWT interface from here; augment the source module
// directly — augmenting "next-auth/jwt" fails under moduleResolution:bundler (TS2664).
// Consumers importing JWT must import from "@auth/core/jwt" to see these fields.
declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    systemRole: SystemRole;
    employmentType: EmploymentType;
    jobFunction: JobFunction;
    mustChange: boolean; // 신규 — 로그인 시점 강제변경 플래그(session 콜백이 DB로 재확인해 최종 결정)
    status: string;      // 신규 — 로그인 시점 status(세션 재검증은 DB가 권위)
    // iat은 @auth/core가 표준 발급(초 단위). 세션 무효화는 DB 시각 > iat 비교로 판단.
  }
}
```

### 5. 최소 구현 — config.ts (jwt 발급 클레임 + session DB 권위 재구성·재검증)

`src/lib/auth/config.ts`. `authorized` 콜백은 **그대로 보존**. `jwt`는 발급 클레임 추가, `session`은 **DB 권위값으로 `session.user`를 fresh 재구성** + 순수 헬퍼 `isSessionValid`(step 2)에 무효 판정 위임 + **무효 시 `session.user` 명시적 제거**(finding #1)하도록 교체한다. `@/lib/prisma`·`isSessionValid` import 추가.

**finding #1 핵심:** ① `select`에 `systemRole`/`name`/`email`/`employmentType`/`jobFunction`를 **추가**하고 `session.user`를 **이 DB 값으로** 채운다 — `systemRole`을 **절대 `token.systemRole`(stale JWT)에서 가져오지 않는다**(task-05 ActorContext.isOwner의 권위원이므로, 강등된 OWNER가 anti-escalation을 우회하는 것을 차단). ② 무효 분기에서 들어온 `session.user`(NextAuth가 prefill했을 수 있음)를 **`delete`로 제거**한다 — 그냥 `return session` 하면 prefilled user가 새어 나간다.

```ts
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
```

> `select`의 `systemRole`/`employmentType`/`jobFunction`는 Prisma enum이라 `string`/enum 타입으로 들어온다. `SessionUser`의 좁은 union으로 좁힐 때 위처럼 `as SystemRole` 단언을 쓴다(DB가 권위라 값 자체는 항상 유효 enum). `types.ts`의 `SystemRole`/`EmploymentType`/`JobFunction` export를 그대로 재사용한다.

```
npm test -- tests/lib/auth/session-invalidation   # expect PASS
```

### 6. 최소 구현 — authorize가 mustChangePassword·status 반환 (config 클레임 채움)

`src/lib/auth/index.ts`의 `authorize` 반환 객체에 두 필드를 **추가만**(기존 로직·ACTIVE 차단·bcrypt 보존). `passwordHash`가 nullable이 되었으므로(task-01) null 가드도 추가:

```ts
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        // 허용목록(fail-closed): ACTIVE만 통과. INVITED(미활성)·DISABLED·PENDING·REJECTED는 거부.
        if (!user || user.status !== "ACTIVE") return null;
        // 자가가입(C안)은 set-password 전까지 passwordHash가 null → 로그인 불가.
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
```

```
npm run typecheck   # expect 그린 (SessionUser·JWT·User 보강 정합)
```

### 7. 실패 테스트 — 중앙 게이트(must-change면 빈 summary·거부)

`tests/kernel/access/must-change-gate.test.ts`. `loadUserContext`가 must-change면 fail-closed임을 `getPermissionSummary`/`hasPermission` 외부 동작으로 검증. prisma만 모킹.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn(), findMany: vi.fn() },
    userPermissionOverride: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  };
  return { db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getPermissionSummary, hasPermission, requirePermission, ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  h.db.permission.findMany.mockResolvedValue([{ id: "p1", resource: "admin.users", action: "view" }]);
  h.db.permission.findUnique.mockResolvedValue({ id: "p1" });
  h.db.userPermissionOverride.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([{ effect: "ALLOW", scope: "all" }]);
});

describe("mustChangePassword 중앙 게이트(D17)", () => {
  it("must-change 사용자는 getPermissionSummary가 빈 keys(fail-closed)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
  });
  it("must-change OWNER도 빈 keys(OWNER 우회 금지)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [] });
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toEqual([]);
  });
  it("must-change면 hasPermission false·requirePermission ForbiddenError", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: true, roleAssignments: [] });
    expect(await hasPermission("u1", "admin.users", "view")).toBe(false);
    await expect(requirePermission("u1", "admin.users", "view")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("must-change=false면 정상 평가(역할 ALLOW 인정)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "MEMBER", status: "ACTIVE", mustChangePassword: false, roleAssignments: [{ roleId: "r1", startsAt: null, endsAt: null }] });
    expect(await hasPermission("u1", "admin.users", "view")).toBe(true);
    const summary = await getPermissionSummary("u1");
    expect(summary.keys).toContain("admin.users:view");
  });
  it("비-ACTIVE는 기존대로 빈 summary(회귀 보존)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "DISABLED", mustChangePassword: false, roleAssignments: [] });
    expect((await getPermissionSummary("u1")).keys).toEqual([]);
    expect(await hasPermission("u1", "admin.users", "view")).toBe(false);
  });
});
```

```
npm test -- tests/kernel/access/must-change-gate   # expect FAIL (게이트 미구현)
```

### 8. 최소 구현 — kernel/access 중앙 게이트

`src/kernel/access/index.ts`. `loadUserContext`의 select에 `mustChangePassword`를 추가하고, **must-change면 ctx에 플래그를 실어** `hasPermission`/`getPermissionSummary`가 fail-closed로 빠져나가게 한다. 게이트는 **단일 지점**(`loadUserContext`)에 두어 세 진입점이 공유한다. 기존 `withinValidity`/`computeDecision` 호출·시그니처는 보존.

`loadUserContext`와 그 소비부만 교체:

```ts
interface UserContext {
  isOwner: boolean;
  roleIds: string[];
  mustChangePassword: boolean; // 신규 — must-change 세션은 모든 권한 fail-closed(D17)
}

async function loadUserContext(userId: string, now: Date): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      systemRole: true,
      status: true,
      mustChangePassword: true,
      roleAssignments: { select: { roleId: true, startsAt: true, endsAt: true } },
    },
  });
  if (!user) return null;
  if (user.status !== "ACTIVE") return null;
  const roleIds = user.roleAssignments
    .filter((a) => withinValidity(a.startsAt, a.endsAt, now))
    .map((a) => a.roleId);
  return { isOwner: user.systemRole === "OWNER", roleIds, mustChangePassword: user.mustChangePassword };
}
```

`hasPermission` 진입에 게이트(OWNER 단락 평가 **앞**):

```ts
export async function hasPermission(userId: string, resource: string, action: Action): Promise<boolean> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now);
  if (!ctx) return false;
  // D17 하드 게이트: must-change 세션은 어떤 권한도 갖지 않는다(OWNER 포함). change-password/logout 경로는 권한 검사를 거치지 않음.
  if (ctx.mustChangePassword) return false;
  if (ctx.isOwner) return true;
  // ... 이하 기존(permission 조회·override/role 평가·computeDecision) 그대로
```

`getPermissionSummary` 진입에 게이트(OWNER 전체 반환 **앞**):

```ts
export async function getPermissionSummary(userId: string): Promise<PermissionSummary> {
  const now = new Date();
  const ctx = await loadUserContext(userId, now);
  if (!ctx) return { keys: [] };
  // D17 하드 게이트: must-change면 빈 summary(fail-closed). UI useCan(...)도 전부 false → 메뉴/버튼 숨김.
  if (ctx.mustChangePassword) return { keys: [] };

  const permissions = await prisma.permission.findMany({
    select: { id: true, resource: true, action: true },
  });
  // ... 이하 기존(OWNER 전체·override/role 평가) 그대로
```

`requirePermission`은 `hasPermission`을 호출하므로 자동으로 게이트된다(변경 불필요 — 기존 코드 보존).

```
npm test -- tests/kernel/access/must-change-gate   # expect PASS
npm test -- tests/kernel/access                     # expect PASS(기존 decision/catalog/leave-permissions 회귀 보존)
```

### 9. 실패 테스트 — federation `verifySession` must-change/세션무효 차단

`tests/lib/auth/federation.test.ts`(기존 파일에 추가). `/api/auth/verify`는 `requirePermission`/`getPermissionSummary`가 아니라 `verifySession`을 통해 `X-Auth-*` 헤더·그룹을 발급한다(access-layer 미경유). must-change·세션무효 사용자는 federation 헤더/그룹도 받지 못해야 한다(finding #2). 기존 `verifySession` describe 블록의 mock 구조(`mockAuth`/`mockFindUnique`)를 그대로 재사용하되, DB row가 `mustChangePassword`·`passwordChangedAt`·`sessionInvalidatedAt`를 포함하도록 보강한다.

```ts
// (기존 federation.test.ts의 "verifySession" describe 블록에 케이스 추가)
// 공통: mockAuth가 세션 user를 돌려주고 mockFindUnique가 DB 권위 row를 돌려준다.
// 기존 ACTIVE 케이스의 mockFindUnique도 mustChangePassword:false·무효화 시각 null을 포함하도록 보강한다.

it("must-change 사용자는 null(federation 헤더/그룹 미발급)", async () => {
  const { verifySession } = await import("@/lib/auth/federation");
  // ISSUED는 세션 발급 시각(초). DB 시각 비교용으로 같은 기준을 쓴다.
  mockAuth.mockResolvedValue({ user: { id: "u1" } });
  mockFindUnique.mockResolvedValue({
    id: "u1", email: "a@b.com", systemRole: "MEMBER", status: "ACTIVE",
    mustChangePassword: true, passwordChangedAt: null, sessionInvalidatedAt: null,
  });
  expect(await verifySession()).toBeNull();
});

it("passwordChangedAt이 세션 발급 이후면 null(비번변경 세션무효)", async () => {
  const { verifySession } = await import("@/lib/auth/federation");
  // auth() 세션의 발급시각(iat)보다 DB passwordChangedAt이 뒤 → 무효.
  mockAuth.mockResolvedValue({ user: { id: "u1" } });
  mockFindUnique.mockResolvedValue({
    id: "u1", email: "a@b.com", systemRole: "MEMBER", status: "ACTIVE",
    mustChangePassword: false,
    passwordChangedAt: new Date(Date.now() + 60_000), // 미래 → 어떤 발급시각보다도 뒤
    sessionInvalidatedAt: null,
  });
  expect(await verifySession()).toBeNull();
});
```

> 발급시각(iat)을 verifySession 안에서 어떻게 얻는지는 step 10 구현 결정에 달려 있다(아래). 테스트는 "must-change면 null", "무효화 시각이 발급 이후면 null"이라는 **외부 동작**만 고정하고, iat 출처(세션 객체에 노출 vs. `auth()` 토큰)는 구현 단계에서 정한다. mock은 `passwordChangedAt`을 충분히 미래로 둬 어떤 합리적 발급시각에 대해서도 무효가 되게 한다.

```
npm test -- tests/lib/auth/federation   # expect FAIL (must-change/무효화 미차단)
```

### 10. 최소 구현 — federation `verifySession` 공유 세션 해석

`src/lib/auth/federation/index.ts`. 현재 `verifySession`은 `status !== "ACTIVE"`만 거른다. 이를 **공유 세션 해석 계층**으로 일원화한다: must-change면 즉시 `null`, 무효화 시각(`passwordChangedAt`/`sessionInvalidatedAt`)은 `isSessionValid`(step 2)로 판정해 `null`. **access-layer를 거치지 않는 federation 경로에도 동일 차단을 박는 것이 finding #2의 핵심**이다.

```ts
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
```

> **iat 출처 주의:** `auth()`가 반환하는 `session.user`는 이미 session 콜백(step 5)이 DB로 재검증·재구성한 결과다 — 즉 session 콜백 시점에 무효 세션은 여기 도달하지 못한다(`session.user`가 없어 위에서 `null` 반환). 따라서 `verifySession`의 `isSessionValid` 호출은 **session 콜백 통과 후의 2차 방어선**이며, 발급시각으로 `now`(현재 초)를 써 "DB 무효화 시각이 미래(시계 역행/직후 레이스)"인 극단만 추가로 거른다. must-change 차단은 session 콜백이 세션을 비우지 않으므로(must-change여도 세션은 유효, 게이트만 권한 0) **여기서 반드시 직접 확인**해야 한다 — finding #2의 실질적 누수 지점.

```
npm test -- tests/lib/auth/federation   # expect PASS
```

### 11. 실패 테스트 — change-password 라우트(자발/강제)

`tests/app/api/auth/change-password.test.ts`. repository(`changePasswordTx`)·prisma·bcrypt를 모킹하고, `auth`(세션)도 모킹해 라우트 핸들러를 직접 호출.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  changePasswordTx: vi.fn(),
  authMock: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => h.authMock(...a) }));
vi.mock("@/modules/admin/users/repositories", () => ({ changePasswordTx: (...a: unknown[]) => h.changePasswordTx(...a) }));
vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => h.compare(...a), hash: (...a: unknown[]) => h.hash(...a) } }));

import { POST } from "@/app/api/auth/change-password/route";

const req = (body: unknown) => new Request("http://localhost/api/auth/change-password", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.hash.mockResolvedValue("newhash");
  h.changePasswordTx.mockResolvedValue(undefined);
});

describe("POST /api/auth/change-password", () => {
  it("미인증이면 401, changePasswordTx 미호출", async () => {
    h.authMock.mockResolvedValue(null);
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "newpassword12" }));
    expect(res.status).toBe(401);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("newPassword 12자 미만이면 400", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("자발 변경: 현재 비번 일치 → changePasswordTx(해시·now) 호출·200", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    h.compare.mockResolvedValue(true);
    const res = await POST(req({ currentPassword: "oldpassword12", newPassword: "newpassword12" }));
    expect(res.status).toBe(200);
    expect(h.compare).toHaveBeenCalledWith("oldpassword12", "oldhash");
    expect(h.changePasswordTx).toHaveBeenCalledWith("u1", "newhash", expect.any(Date));
  });
  it("자발 변경: 현재 비번 불일치 → 400, changePasswordTx 미호출", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    h.compare.mockResolvedValue(false);
    const res = await POST(req({ currentPassword: "wrongpass1234", newPassword: "newpassword12" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("자발 변경: currentPassword 누락이면 400(자발은 현재 비번 필수)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: false } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "oldhash", mustChangePassword: false });
    const res = await POST(req({ newPassword: "newpassword12" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
  it("강제 변경: must-change 사용자는 현재(임시) 비번 일치 시 변경·플래그 해제(changePasswordTx)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: true } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "temphash", mustChangePassword: true });
    h.compare.mockResolvedValue(true);
    const res = await POST(req({ currentPassword: "temppassword1", newPassword: "newpassword12" }));
    expect(res.status).toBe(200);
    expect(h.compare).toHaveBeenCalledWith("temppassword1", "temphash");
    expect(h.changePasswordTx).toHaveBeenCalledWith("u1", "newhash", expect.any(Date));
  });
  it("강제 변경도 현재(임시) 비번 불일치면 400(fresh 로그인 외 우회 금지)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1", mustChangePassword: true } });
    h.db.user.findUnique.mockResolvedValue({ passwordHash: "temphash", mustChangePassword: true });
    h.compare.mockResolvedValue(false);
    const res = await POST(req({ currentPassword: "wrong1234567", newPassword: "newpassword12" }));
    expect(res.status).toBe(400);
    expect(h.changePasswordTx).not.toHaveBeenCalled();
  });
});
```

```
npm test -- tests/app/api/auth/change-password   # expect FAIL (라우트·스키마 미존재)
```

### 12. 최소 구현 — changePasswordSchema (로컬 validations)

`src/modules/admin/users/validations/change-password.ts` (S7의 `changePasswordSchema`를 task-04 머지 전까지 로컬 정의 — Divergence 참조). leave validations의 zod 관례(`z.object`, `.min`):

```ts
import { z } from "zod";

// D15: newPassword는 정책상 12자+. currentPassword는 선택(자발 변경=필수 검증을 라우트가 수행, 강제 변경=임시 비번 확인).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(12),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
```

### 13. 최소 구현 — change-password 라우트

`src/app/api/auth/change-password/route.ts`. 본인만(세션 uid). 자발=현재 비번 필수, 강제(must-change)=현재(임시) 비번 확인. 검증 후 `bcrypt.hash`→`changePasswordTx`(S6). `change-password`는 **권한 게이트(D17)의 allowlist**라 `requirePermission`을 거치지 않는다(본인 세션만 검사).

```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { changePasswordTx } from "@/modules/admin/users/repositories";
import { UserConflictError } from "@/modules/admin/users/errors";
import { changePasswordSchema } from "@/modules/admin/users/validations/change-password";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;

  const userId = session.user.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  // 자가가입 미설정·비활성 등 passwordHash 없으면 변경 경로 불가(세션 콜백이 이미 무효화하지만 방어적으로).
  if (!user?.passwordHash) return NextResponse.json({ error: "비밀번호를 변경할 수 없습니다." }, { status: 400 });

  // D15: 자발 변경·강제(임시 비번) 변경 모두 현재 비밀번호 확인을 요구한다(우회 금지).
  if (!currentPassword) return NextResponse.json({ error: "현재 비밀번호를 입력해 주세요." }, { status: 400 });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "현재 비밀번호가 일치하지 않습니다." }, { status: 400 });

  try {
    const newHash = await bcrypt.hash(newPassword, 10);
    // S6: passwordHash + passwordChangedAt=now + mustChangePassword=false (타 세션 무효화 기준 = passwordChangedAt).
    await changePasswordTx(userId, newHash, new Date());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
```

```
npm test -- tests/app/api/auth/change-password   # expect PASS
```

### 14. 커밋

```
git add src/lib/auth/types.ts src/lib/auth/session-validity.ts src/lib/auth/config.ts src/lib/auth/index.ts \
        src/lib/auth/federation/index.ts \
        src/kernel/access/index.ts \
        src/app/api/auth/change-password/route.ts \
        src/modules/admin/users/validations/change-password.ts \
        tests/lib/auth/session-validity.test.ts \
        tests/lib/auth/session-invalidation.test.ts \
        tests/lib/auth/federation.test.ts \
        tests/kernel/access/must-change-gate.test.ts \
        tests/app/api/auth/change-password.test.ts
git commit -m "feat(user-mgmt): 비번변경·세션무효화(isSessionValid 헬퍼)·mustChangePassword 중앙게이트·auth 콜백·verify federation 게이트(task-07)"
```

## Acceptance Criteria
- `npm test -- tests/lib/auth/session-validity` → PASS. 순수 헬퍼 `isSessionValid(tokenIat, snap)`이 status≠ACTIVE·`passwordChangedAt`/`sessionInvalidatedAt` > iat(strict `>`)면 false, 모두 iat 이전/같으면 true.
- `npm test -- tests/lib/auth/session-invalidation` → PASS. jwt 콜백이 `mustChange`/`status` 클레임 저장, session 콜백이 **DB 권위값으로 `session.user`를 fresh 재구성**(특히 `systemRole`/`name`/`email` — stale JWT가 OWNER여도 DB가 MEMBER면 `session.user.systemRole==="MEMBER"`; finding #1)하고 `isSessionValid` 무효 시 `session.user`를 **제거**(prefilled user도 비움). ① DB status≠ACTIVE ② `passwordChangedAt`/`sessionInvalidatedAt` > `token.iat`. 유효하면 DB의 현재 `mustChangePassword` 반영.
- `npm test -- tests/lib/auth/federation` → PASS. `verifySession`이 **must-change 사용자에 대해 null**(federation 헤더/그룹 미발급), 무효화 시각이 발급 이후면 null, 강등은 DB systemRole로 claims 산출(기존 회귀 보존) — finding #2.
- `npm test -- tests/kernel/access/must-change-gate` → PASS. must-change면 `getPermissionSummary` 빈 keys·`hasPermission` false·`requirePermission` ForbiddenError(OWNER 포함). false면 정상 평가.
- `npm test -- tests/app/api/auth/change-password` → PASS. 미인증 401 / 12자 미만 400 / 자발 현재비번 불일치·누락 400 / 일치 시 `changePasswordTx(uid, hash, Date)` 호출·200 / 강제변경도 임시비번 확인 후 변경.
- `npm test -- tests/kernel/access` → PASS (decision·catalog·leave-permissions·user-management-catalog 회귀 보존).
- `npm run typecheck` → 그린 (SessionUser·JWT·NextAuth `User` 보강 정합, `authorize` 반환 정합, config의 DB enum→union 단언 정합).
- `npm run lint` → 그린.
- (DB 있을 때만, task-09 통합에서 증명) must-change 세션으로 `change-password`·`logout` 외 API 호출 시 403/빈 summary·`/api/auth/verify` 401, 비번 변경 후 이전 발급 JWT는 session 콜백에서 무효, **강등된 OWNER는 `session.user.systemRole`이 non-OWNER라 anti-escalation 우회 불가**.

## Cautions
- **UI 리다이렉트에 의존하지 마라 — API/권한 계층이 거부해야 한다(D17).** `src/middleware.ts`의 강제변경 페이지 리다이렉트는 task-08(UI)의 UX일 뿐이다. 직접 API 호출(curl) 봉쇄는 **이 task의 중앙 게이트**(`loadUserContext`→`hasPermission`/`getPermissionSummary` fail-closed)가 책임진다. 게이트를 라우트 핸들러마다 개별 삽입하지 말 것 — 단일 지점(`loadUserContext`)에 둬 세 진입점이 공유한다(개별 핸들러 인가방식 비의존).
- **세션 무효화는 JWT `iat` 비교 — 시계 동기에 주의.** `token.iat`는 **초 단위**(@auth/core 표준), DB 시각은 ms — 반드시 `iat * 1000`으로 환산해 비교한다. `passwordChangedAt`/`sessionInvalidatedAt` 둘 다 발급시각 이후일 때만 무효(같거나 이전이면 이 세션이 더 최신 → 유지). 서버 시계가 뒤로 튀면 방금 발급한 세션이 무효화될 수 있으니 비교는 **strict `>`**(같으면 유효)로 둔다.
- **무효 판정 로직은 순수 헬퍼 `isSessionValid`(`src/lib/auth/session-validity.ts`) 단일 출처에만 둘 것(§S9).** session 콜백·federation `verifySession`은 **DB 조회 + 이 헬퍼 호출**만 하고, status·iat 비교를 호출부에 다시 인라인하지 마라(그러면 task-09 단위테스트가 검증하는 대상과 어긋난다). iat 초→ms 환산도 헬퍼 내부에 둔다(호출부는 발급시각을 그대로 초 단위로 전달). 단, must-change 차단은 `isSessionValid`의 범위가 아니다(세션은 유효, 권한만 0) — session 콜백은 `mustChangePassword`를 user에 실어 게이트가 막게 하고, federation `verifySession`은 must-change면 직접 `null`을 반환한다.
- **session 콜백은 `session.user`를 DB 권위값으로 fresh 재구성한다(finding #1) — stale JWT를 신뢰하지 마라.** `systemRole`/`name`/`email`/`employmentType`/`jobFunction`를 `select`에 포함해 **DB 값으로** user를 채운다. 특히 `systemRole`은 task-05 `ActorContext.isOwner`의 권위원이라, `token.systemRole`(강등 전 스냅샷)을 그대로 쓰면 강등된 OWNER가 anti-escalation을 우회한다. 무효 분기에서는 `delete s.user`로 prefilled user까지 **명시적으로 제거**(그냥 `return session` 금지 — 들어온 user가 새어 나간다).
- **must-change여도 세션 자체는 유효하다(무효화 아님).** `mustChangePassword=true`는 로그인·세션 유지는 되되 **권한만 0**이 되는 상태다(강제변경 페이지에 접근·change-password 호출 가능해야 하므로). 세션 무효화(`session.user` 비움)와 혼동 금지 — 무효화는 DISABLED·비번변경·재설정에만.
- **`change-password`·`logout`을 권한 게이트로 막지 마라.** 이 두 경로는 `requirePermission`/`getPermissionSummary`를 호출하지 않고 본인 세션만 검사한다(allowlist). change-password 라우트에 `requirePermission`을 넣으면 must-change 사용자가 자기 비번도 못 바꿔 deadlock.
- **`authorize`의 ACTIVE 차단·bcrypt 로직을 바꾸지 마라.** `mustChangePassword`/`status` 반환 **추가**와 nullable `passwordHash` null 가드만 surgical하게 더한다(task-01에서 nullable 됨). ACTIVE+must-change 사용자는 **로그인은 허용**(그래야 강제변경 가능)하고 게이트가 권한을 막는다 — authorize에서 must-change를 차단하지 말 것.
- **session 콜백은 매 요청 DB 1회 조회를 추가한다.** `findUnique`(PK·좁은 select)라 비용은 작지만, 이 재검증이 "JWT 무상태 → 즉시 무효화 불가" 한계를 메우는 핵심이므로 캐싱/생략하지 말 것. select는 **무효화 필드**(status·passwordChangedAt·sessionInvalidatedAt·mustChangePassword) + **권위 재구성 필드**(systemRole·name·email·employmentType·jobFunction)로 한정한다(finding #1 — fresh 재구성에 필요한 최소 집합). 그 외 필드는 select하지 않는다.
- **`getPermissionSummary`/`hasPermission`의 must-change 게이트는 OWNER 단락 평가보다 앞에 둘 것.** 순서가 뒤면 OWNER가 게이트를 우회한다(D17 "OWNER 포함" 위반).
- **federation 게이트는 `verifySession`(공유 헬퍼) 한 곳에만(finding #2).** `/api/auth/verify`의 라우트 핸들러(`src/app/api/auth/verify/route.ts`)·`claims.ts`는 **수정하지 마라** — must-change/세션무효 차단을 라우트마다 흩어 박지 말고 `verifySession`이 단일 진입점으로 처리한다(라우트는 이미 `verifySession()===null`이면 401). `verifySession`의 must-change는 session 콜백이 못 거르는 누수 지점이므로(must-change여도 세션은 유효) **반드시 `verifySession` 안에서 직접** `mustChangePassword` → `null`로 막는다.
- **이 task에서 reset-password·signup·verify *라우트*를 새로 만들지 마라.** reset-password는 task-05(서비스 가드 D14), signup/verify(set-password)는 task-06. 여기서 만드는 공개 라우트는 `change-password` 하나뿐(본인 인증). 기존 `/api/auth/verify`(federation)는 **새로 만드는 것이 아니라** 그 헬퍼 `verifySession`을 게이트로 보강하는 것이다(위 caution). 세션 콜백·`verifySession`은 `sessionInvalidatedAt`(task-03 reset/disable가 세팅)을 **소비만** 한다.
```
