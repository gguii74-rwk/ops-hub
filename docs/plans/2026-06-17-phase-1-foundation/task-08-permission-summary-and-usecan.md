# Task 08 — 권한 summary API + useCan 훅 + requirePermission 배선

목적: "메뉴 숨김은 UX, API도 같은 키를 검사"(ADR-0002 규칙 1)를 실제로 잇는다 — ① 현재 사용자 허용 키를 주는 `GET /api/auth/permissions`, ② UI용 `useCan` 훅(+Provider), ③ `requirePermission`을 실제 보호 라우트에 배선한 예.

## Files

- Create: `src/app/api/auth/permissions/route.ts`
- Create: `src/lib/auth/permissions-client.tsx`
- Create: `src/app/api/admin/audit/route.ts`

## Prep

- §Shared Contracts **SC-5**(`getPermissionSummary`/`requirePermission`), **SC-9**(키 표기 `resource:action`). `useCan`/`PermissionProvider`는 SC에 없으며 **이 task가 도입**하는 클라이언트 표면이다.
- 경계(SC-1): `app → kernel/lib` 허용, **`lib → kernel` 금지**. 따라서 클라이언트 훅(lib)은 kernel을 import하지 않고 키 포맷을 인라인한다.

## Deps

04(권한 엔진), 06(auth 세션).

## Steps

### 1. 권한 summary API — `src/app/api/auth/permissions/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ keys: [] }, { status: 401 });
  }
  const summary = await getPermissionSummary(session.user.id);
  return NextResponse.json(summary);
}
```

### 2. 클라이언트 Provider + useCan — `src/lib/auth/permissions-client.tsx`

서버가 셸에서 받은 summary 키를 컨텍스트로 내려주고, `useCan`이 조회한다. **kernel을 import하지 않는다**(경계). 키 포맷은 SC-9 그대로 인라인.

```tsx
"use client";

import { createContext, useContext } from "react";

const PermissionContext = createContext<ReadonlySet<string>>(new Set());

export function PermissionProvider({
  keys,
  children,
}: {
  keys: string[];
  children: React.ReactNode;
}) {
  return <PermissionContext.Provider value={new Set(keys)}>{children}</PermissionContext.Provider>;
}

/** UI 노출 판정. 서버 requirePermission과 동일한 "resource:action" 키를 공유한다(SC-9). */
export function useCan(resource: string, action: string): boolean {
  const keys = useContext(PermissionContext);
  return keys.has(`${resource}:${action}`);
}
```

### 3. requirePermission 배선 예 — `src/app/api/admin/audit/route.ts`

같은 키(`admin.audit:view`)를 서버에서 강제. 거부 시 403.

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requirePermission } from "@/kernel/access";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  try {
    await requirePermission(session.user.id, "admin.audit", "view");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ logs });
}
```

### 4. 검증

```bash
npm run typecheck   # 에러 0
npm run lint        # 에러 0 — 특히 permissions-client.tsx가 kernel을 import하지 않아 boundaries 위반 없음
npm run build       # 성공
```

스모크(dev 서버, 미인증):

```bash
npm run dev
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/permissions   # 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/audit          # 401
```

(로그인 후 200/403 분기는 task-10 AC에서 권한별로 검증.)

### 5. 커밋

```bash
git add -A
git commit -m "Add permission summary API, useCan hook, and requirePermission-guarded route"
```

## Acceptance Criteria

- `GET /api/auth/permissions`가 인증 시 `{ keys: string[] }`, 미인증 시 401.
- `useCan`/`PermissionProvider`가 `lib`에 있고 **kernel을 import하지 않는다**(lint 통과가 증거).
- `GET /api/admin/audit`가 `admin.audit:view` 권한이 없으면 403, 있으면 로그를 반환.
- typecheck/lint/build 에러 0.

## Cautions

- **Don't `permissions-client.tsx`에서 `@/kernel/...`을 import하지 마라. Reason:** lib→kernel은 경계 위반(SC-1). 키 포맷은 단순 문자열이라 인라인한다(SC-9가 단일 출처 문서).
- **Don't 권한을 UI에서만 숨기고 API 검사를 빼지 마라. Reason:** ADR-0002 규칙 1. `useCan`(노출)과 `requirePermission`(실행)이 항상 같은 키를 공유해야 한다.
- **Don't summary를 페이지마다 재요청하도록 만들지 마라. Reason:** 셸 레이아웃(task-10)에서 한 번 받아 `PermissionProvider`로 내린다. 훅은 컨텍스트만 읽는다.
