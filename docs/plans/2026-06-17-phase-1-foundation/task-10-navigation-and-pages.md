# Task 10 — 내비게이션 셸 + 보호 placeholder 페이지

목적: 앞선 모든 task를 통합한다 — 권한으로 필터된 DB 내비게이션, 인증 셸 레이아웃(미인증 → `/login`), `PermissionProvider`로 내려준 `useCan`, 로그아웃, 그리고 5개 보호 placeholder 페이지. 여기서 Phase 1 완료기준(로그인/로그아웃, 5개 라우트 보호)을 충족한다.

## Files

- Create: `src/kernel/navigation/index.ts`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/app/(app)/calendar/page.tsx`
- Create: `src/app/(app)/workflows/page.tsx`
- Create: `src/app/(app)/leave/page.tsx`
- Create: `src/app/(app)/admin/page.tsx`
- Create: `src/app/(app)/admin/admin-links.tsx`

## Prep

- §Shared Contracts **SC-5**(`getPermissionSummary`), **SC-9**(nav), **SC-1**(경계: app→kernel/lib 허용).
- task-08의 `PermissionProvider`/`useCan`, task-06의 `auth`/`signOut`.

## Deps

08(summary API·useCan), 09(seed 데이터).

## Steps

### 1. 내비게이션 로더 — `src/kernel/navigation/index.ts`

DB의 `NavigationItem`을 권한 summary 키로 필터한다.

```ts
import { prisma } from "@/lib/prisma";

export interface NavNode {
  key: string;
  label: string;
  href: string | null;
}

/** 활성 최상위 메뉴를 허용 키로 필터해 정렬 반환. requiredPermission이 없으면 공개. */
export async function loadNavigation(allowedKeys: string[]): Promise<NavNode[]> {
  const items = await prisma.navigationItem.findMany({
    where: { isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      key: true,
      label: true,
      href: true,
      requiredPermission: { select: { resource: true, action: true } },
    },
  });
  const allowed = new Set(allowedKeys);
  return items
    .filter((item) => {
      if (!item.requiredPermission) return true;
      return allowed.has(`${item.requiredPermission.resource}:${item.requiredPermission.action}`);
    })
    .map((item) => ({ key: item.key, label: item.label, href: item.href }));
}
```

### 2. 인증 셸 레이아웃 — `src/app/(app)/layout.tsx`

`(app)`은 라우트 그룹이라 URL에 안 나타난다(→ `/dashboard` 등 그대로). 미인증이면 `/login`.

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { loadNavigation } from "@/kernel/navigation";
import { PermissionProvider } from "@/lib/auth/permissions-client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const summary = await getPermissionSummary(session.user.id);
  const nav = await loadNavigation(summary.keys);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <PermissionProvider keys={summary.keys}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: "100vh" }}>
        <aside style={{ borderRight: "1px solid var(--border)", padding: 16 }}>
          <strong>ops-hub</strong>
          <nav style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {nav.map((node) => (
              <Link key={node.key} href={node.href ?? "#"}>
                {node.label}
              </Link>
            ))}
          </nav>
          <form action={logout} style={{ marginTop: 24 }}>
            <button type="submit">로그아웃</button>
          </form>
        </aside>
        <main style={{ padding: 24 }}>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {session.user.name} · {session.user.systemRole}
          </p>
          {children}
        </main>
      </div>
    </PermissionProvider>
  );
}
```

### 3. placeholder 페이지 4개

`src/app/(app)/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <section>
      <h1>대시보드</h1>
      <p>준비 중입니다.</p>
    </section>
  );
}
```

`src/app/(app)/calendar/page.tsx`:

```tsx
export default function CalendarPage() {
  return (
    <section>
      <h1>캘린더</h1>
      <p>준비 중입니다.</p>
    </section>
  );
}
```

`src/app/(app)/workflows/page.tsx`:

```tsx
export default function WorkflowsPage() {
  return (
    <section>
      <h1>업무</h1>
      <p>준비 중입니다.</p>
    </section>
  );
}
```

`src/app/(app)/leave/page.tsx`:

```tsx
export default function LeavePage() {
  return (
    <section>
      <h1>연차</h1>
      <p>준비 중입니다.</p>
    </section>
  );
}
```

### 4. admin 페이지 — `useCan` 데모

`src/app/(app)/admin/page.tsx` — 메뉴 숨김(UX)과 별개로 **라우트 자체를 같은 키로 인가**한다(ADR-0002 규칙1):

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/kernel/access";
import { AdminLinks } from "./admin-links";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasPermission(session.user.id, "admin.users", "view"))) {
    redirect("/dashboard");
  }
  return (
    <section>
      <h1>관리</h1>
      <AdminLinks />
    </section>
  );
}
```

> 패턴 메모: 민감 라우트는 이렇게 페이지 진입에서 `hasPermission`(또는 route handler에서 `requirePermission`)으로 막는다. 나머지 4개 placeholder 페이지는 Phase 1엔 빈 stub이라 인증(셸)만으로 충분하지만, 실제 데이터가 붙는 플랜에서 각 라우트에 같은 가드를 적용한다.

`src/app/(app)/admin/admin-links.tsx`:

```tsx
"use client";

import { useCan } from "@/lib/auth/permissions-client";

export function AdminLinks() {
  const canAudit = useCan("admin.audit", "view");
  const canUsers = useCan("admin.users", "view");
  return (
    <ul>
      {canUsers ? <li>사용자</li> : null}
      {canAudit ? <li>감사 로그</li> : null}
    </ul>
  );
}
```

### 5. 검증 — 정적

```bash
npm run typecheck   # 에러 0
npm run lint        # 에러 0 (app → kernel/lib 의존만)
npm run build       # 성공 (5개 라우트 빌드)
```

### 6. 검증 — 통합(E2E, DB + seed + dev 서버)

task-09 seed가 적재된 상태에서:

```bash
npm run dev
```

1. 미인증으로 `http://localhost:3000/dashboard` → `/login`으로 리다이렉트.
2. `/login`에서 seed admin(`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`)으로 로그인 → `/dashboard` 렌더, 좌측에 메뉴 5개(OWNER라 전부) + 이름/역할 표시.
3. `/workflows`·`/leave`·`/admin` 직접 접근 가능(인증됨). `/admin`에 "사용자"·"감사 로그" 항목 보임(useCan).
4. `/api/auth/permissions` → 다수 키(OWNER 전체). `/api/admin/audit` → 200 + logs.
5. 로그아웃 → `/login`. 이후 `/dashboard` 재접근 시 다시 `/login`으로.

### 7. 커밋 + 엔트리포인트 갱신

```bash
git add -A
git commit -m "Add app shell with permission-filtered navigation and protected pages"
```

엔트리포인트(`docs/plans/2026-06-17-phase-1-foundation.md`) Task 표의 각 행 status를 `[x]`로, outcome 한 줄을 채운다.

## Acceptance Criteria

- 미인증 시 보호 라우트 5종이 모두 `/login`으로 리다이렉트(미들웨어 + 셸 이중).
- seed admin으로 로그인/로그아웃이 동작한다.
- 셸이 권한으로 필터된 메뉴를 보여준다(OWNER는 5개 전부).
- `/admin`의 `useCan` 데모가 권한에 따라 항목을 노출한다.
- `/admin` 페이지가 `admin.users:view` 미보유 시 `/dashboard`로 리다이렉트한다(가드 코드 경로 존재. 음성 케이스 E2E는 비관리자 사용자가 생기는 플랜에서 검증).
- typecheck/lint/build 에러 0, 통합 시나리오 1~5 통과.

## Cautions

- **Don't 셸에서 미들웨어를 믿고 `auth()` 체크를 빼지 마라. Reason:** 미들웨어 matcher가 빗나가도 페이지가 노출되면 안 된다. 셸의 `auth()`+redirect가 2차 방어선이다(defense in depth).
- **Don't 메뉴 필터만으로 보호했다고 여기지 마라. Reason:** 메뉴 숨김은 UX다. 실제 데이터·액션은 각 route handler의 `requirePermission`이 같은 키로 막아야 한다(ADR-0002 규칙 1, task-08 예시 참조).
- **Don't `(app)` 그룹 경로를 URL에 넣지 마라. Reason:** 괄호 그룹은 URL에 안 나온다. 페이지 파일을 `(app)/dashboard/page.tsx`에 두면 URL은 `/dashboard`다.
