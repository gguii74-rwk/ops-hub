# Task 07 — 권한 catalog·seed 보강

**Purpose:** leave 도메인이 쓰는 권한 키를 catalog·seed에 추가. 신규 `cancel` 액션, leave Permission 행, 작업자 role에 `leave.request:cancel` 부여. 관리자(승인·할당·수정·삭제)는 `pm`(`["*"]`)/OWNER가 보유.

## Files
- Modify: `src/kernel/access/decision.ts` (`Action` union에 `cancel`)
- Modify: `src/kernel/access/catalog.ts` (`ACTIONS`에 `cancel`)
- Modify: `prisma/seed-permissions.ts` (`EXTRA_PERMISSIONS`에 leave 키)
- Modify: `prisma/seed-roles.ts` (`ROLE_ALLOW` 작업자 role에 `leave.request:cancel`)
- Create: `tests/kernel/access/leave-permissions.test.ts`

## Prep
- spec §8 / entrypoint §SC-7.
- 권한 부여 메커니즘: `seed.ts`가 `VIEW_RESOURCES`(전 resource×view) + `EXTRA_PERMISSIONS`로 Permission 행 생성, `ROLE_ALLOW`로 RolePermission(ALLOW/all) 생성. `pm: ["*"]`=전체.
- `Action`은 decision.ts의 독립 union(ACTIONS에서 파생 아님) → **두 파일 모두** 수정.

## Deps
없음(03·07 병렬 가능).

## Steps

### 1. 실패 테스트
`tests/kernel/access/leave-permissions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ACTIONS } from "@/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";
import { ROLE_ALLOW } from "../../../prisma/seed-roles";

const hasExtra = (r: string, a: string) => EXTRA_PERMISSIONS.some(([res, act]) => res === r && act === a);

describe("leave 권한", () => {
  it("ACTIONS에 cancel 추가", () => {
    expect(ACTIONS).toContain("cancel");
  });
  it("EXTRA_PERMISSIONS에 leave 관리 키", () => {
    expect(hasExtra("leave.request", "cancel")).toBe(true);
    expect(hasExtra("leave.request", "update")).toBe(true);
    expect(hasExtra("leave.request", "delete")).toBe(true);
    expect(hasExtra("leave.approval", "view")).toBe(true);
    expect(hasExtra("leave.allocation", "view")).toBe(true);
  });
  it("작업자 role 전원이 leave.request:cancel 보유", () => {
    for (const key of ["regular-developer", "contractor-developer", "contractor-content", "contractor-civil-response"]) {
      expect(ROLE_ALLOW[key]).toContain("leave.request:cancel");
      expect(ROLE_ALLOW[key]).toContain("leave.request:create");
    }
  });
});
```

```
npm test -- tests/kernel/access/leave-permissions   # expect FAIL
```

### 2. decision.ts — Action에 cancel
`src/kernel/access/decision.ts`:

```ts
export type Action =
  | "view" | "create" | "update" | "delete" | "approve" | "cancel"
  | "generate" | "review" | "send" | "configure" | "export" | "impersonate";
```

### 3. catalog.ts — ACTIONS에 cancel
`src/kernel/access/catalog.ts`의 `ACTIONS` 배열:

```ts
export const ACTIONS = [
  "view", "create", "update", "delete", "approve", "cancel",
  "generate", "review", "send", "configure", "export", "impersonate",
] as const;
```

### 4. seed-permissions.ts — EXTRA_PERMISSIONS
`prisma/seed-permissions.ts`의 배열에 추가(기존 leave 항목 뒤):

```ts
  ["leave.request", "create"],
  ["leave.request", "cancel"],
  ["leave.request", "update"],
  ["leave.request", "delete"],
  ["leave.approval", "view"],
  ["leave.approval", "approve"],
  ["leave.allocation", "view"],
  ["leave.allocation", "configure"],
```

(기존 `["leave.request","create"]`/`["leave.approval","approve"]`/`["leave.allocation","configure"]`는 유지하고 중복 없이 병합한다.)

### 5. seed-roles.ts — 작업자 role에 cancel
`prisma/seed-roles.ts`의 각 작업자 role 배열에 `"leave.request:cancel"` 추가(기존 `leave.request:create` 옆). 예 `regular-developer`:

```ts
  "regular-developer": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "calendar.team:view", "workflows.weekly:view", "workflows.billing:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "leave.request:cancel", "workflows.weekly:create", "workflows.weekly:generate",
    "workflows.notification:create",
  ],
```

`contractor-developer`/`contractor-content`/`contractor-civil-response`에도 동일하게 `"leave.request:cancel"`를 `leave.request:create` 옆에 추가한다. `pm`은 `["*"]`라 변경 불필요.

```
npm test -- tests/kernel/access/leave-permissions   # expect PASS
```

### 6. 커밋
```
git add src/kernel/access/decision.ts src/kernel/access/catalog.ts prisma/seed-permissions.ts prisma/seed-roles.ts tests/kernel/access/leave-permissions.test.ts
git commit -m "feat(leave): cancel 액션·leave 권한 키·작업자 role cancel 부여"
```

## Acceptance Criteria
- `npm test -- tests/kernel/access/leave-permissions` → PASS.
- `npm run typecheck` / `npm run lint` → 그린.
- (DB 있을 때) `npm run db:seed` 후 작업자 role에 `leave.request:cancel` RolePermission 존재, `pm`은 전체 보유.

## Cautions
- **Don't `cancel`을 catalog.ts에만 추가하지 말 것.** Reason: `Action`은 decision.ts 독립 union — `requirePermission(.., "cancel")` 타입 오류. 두 파일 동시 수정.
- **Don't EXTRA_PERMISSIONS에서 기존 leave 키를 중복/삭제하지 말 것.** Reason: seed가 `defs.set`으로 dedup하나, 매트릭스 정확 반영을 위해 의도한 키만 둔다.
- **Don't 관리자 키를 작업자 role에 부여하지 말 것.** Reason: `leave.approval:*`/`leave.allocation:*`/`request:update|delete`는 pm/OWNER 전용(중앙 ADMIN 승인, spec D5).
