# task-02 — 권한 카탈로그·NAV 부트스트랩

**목적:** 신규 권한 `admin.navigation`(`view`/`configure`)를 카탈로그·역할 매트릭스에 등록하고, `NAV`를 2단 트리로 확장해 `관리 > 메뉴 관리` 부트스트랩 자식을 추가한다. `NAV`를 "초기 부트스트랩 시드 데이터"로 의미 재정의(D3/D14).

## Files

- **Modify:** `src/kernel/access/catalog.ts` — `RESOURCES`에 `"admin.navigation"`; `NavEntry`에 `children?`; `NAV`의 `관리`에 자식; 주석.
- **Modify:** `prisma/seed-permissions.ts` — `EXTRA_PERMISSIONS`에 `["admin.navigation","configure"]`.
- **Modify:** `prisma/seed-roles.ts` — `ROLE_ALLOW.admin`에 두 키.
- **Create (test):** `tests/kernel/access/navigation-catalog.test.ts`

## Prep

- 스펙 §5(부트스트랩)·§9(권한 카탈로그 변경), 결정 D3/D14/D15.
- 엔트리포인트 §Shared Contracts **SC-10**(부트스트랩 항목)·**SC-3**(권한키).
- 기존 출처: `catalog.ts`(`RESOURCES`/`NavEntry`/`NAV`), `prisma/seed-permissions.ts`(`EXTRA_PERMISSIONS`), `prisma/seed-roles.ts`(`ROLE_ALLOW`).

## Deps

없음. (task-03이 본 태스크의 NAV 트리 형태에 의존.)

## Cautions

- **부트스트랩 자식은 본 태스크만으로는 실제 시드되지 않는다** — `seed.ts`의 트리 처리는 task-03 소관. 본 태스크는 데이터·타입·매트릭스만. typecheck/build는 그대로 green(기존 seed 루프는 `children`을 무시할 뿐 깨지지 않음).
- **권한 카탈로그·역할 매트릭스는 코드 진실원 유지**(메뉴만 DB 이관 — D3). 새 `Permission` 생성은 제외(D15).
- `key`는 안정 식별자 — 부트스트랩 자식 key `admin-navigation`은 사람-읽기 key(D17 예외, 관리자 생성분만 opaque).
- `href`는 `string` 유지(부트스트랩엔 그룹 헤더 없음). 그룹 헤더(null href)는 관리 UI 생성분에서만 — 카탈로그 타입 변경 불필요.

## Step 1 — 실패 테스트: 카탈로그·매트릭스에 admin.navigation 등록

`tests/kernel/access/navigation-catalog.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { RESOURCES, NAV } from "@/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";
import { ROLE_ALLOW } from "../../../prisma/seed-roles";

describe("admin.navigation 권한 카탈로그(D14)", () => {
  it("RESOURCES에 admin.navigation(→ :view 자동 seed)", () => {
    expect(RESOURCES).toContain("admin.navigation");
  });
  it("EXTRA_PERMISSIONS에 [admin.navigation, configure]", () => {
    expect(EXTRA_PERMISSIONS).toContainEqual(["admin.navigation", "configure"]);
  });
  it("admin 역할이 view·configure 둘 다 ALLOW(OWNER는 자동)", () => {
    expect(ROLE_ALLOW.admin).toContain("admin.navigation:view");
    expect(ROLE_ALLOW.admin).toContain("admin.navigation:configure");
  });
});

describe("NAV 부트스트랩 트리(D3/D14)", () => {
  it("기존 5개 대메뉴 보존", () => {
    expect(NAV.map((n) => n.key)).toEqual(["dashboard", "calendar", "workflows", "leave", "admin"]);
  });
  it("관리 대메뉴에 메뉴 관리 자식(href·permission)", () => {
    const admin = NAV.find((n) => n.key === "admin");
    expect(admin?.children).toBeDefined();
    const navItem = admin!.children!.find((c) => c.key === "admin-navigation");
    expect(navItem).toMatchObject({
      key: "admin-navigation",
      label: "메뉴 관리",
      href: "/admin/navigation",
      permission: "admin.navigation:view",
    });
  });
});
```

실행: `npm test -- navigation-catalog` → **FAIL**.

## Step 2 — catalog.ts 수정

`src/kernel/access/catalog.ts`:

`RESOURCES` 배열에 `admin.navigation` 추가(`admin.audit` 줄 뒤):

```ts
  "admin.users", "admin.settings", "admin.audit", "admin.navigation",
```

`NavEntry` 인터페이스에 `children` 추가:

```ts
export interface NavEntry {
  key: string;
  label: string;
  href: string;
  permission: string; // "resource:action"
  children?: readonly NavEntry[]; // 2단 부트스트랩 자식(이후 DB가 진실원 — D3)
}
```

`NAV`를 트리로 — 주석 재정의 + `관리`에 자식:

```ts
// 초기 부트스트랩 시드 데이터. seed.ts가 create-if-absent로 1회 적재하며(task-03),
// 이후 메뉴의 진실원은 DB다(관리 UI에서 편집 — D3). 코드에서 여기를 바꿔도 기존 DB엔 반영되지 않는다(의도).
export const NAV: readonly NavEntry[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar", label: "캘린더", href: "/calendar", permission: "calendar.work:view" },
  { key: "workflows", label: "업무", href: "/workflows", permission: "workflows.weekly:view" },
  { key: "leave", label: "연차", href: "/leave", permission: "leave.request:view" },
  {
    key: "admin", label: "관리", href: "/admin", permission: "admin.users:view",
    children: [
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
    ],
  },
] as const;
```

## Step 3 — seed-permissions.ts·seed-roles.ts 수정

`prisma/seed-permissions.ts` — `EXTRA_PERMISSIONS` 배열에 추가(`admin.*` 그룹 근처):

```ts
  ["admin.navigation", "configure"],
```

`prisma/seed-roles.ts` — `ROLE_ALLOW.admin` 배열에 두 키 추가:

```ts
  admin: [
    "admin.users:view", "admin.users:create", "admin.users:update", "admin.users:approve",
    "admin.settings:configure", "admin.audit:view",
    "admin.navigation:view", "admin.navigation:configure",
  ],
```

실행: `npm test -- navigation-catalog` → **PASS**.

## Acceptance Criteria

- `npm test -- navigation-catalog` → PASS.
- `npm test -- catalog seed-roles` → 기존 카탈로그·역할 테스트 회귀 없음.
- `npm run typecheck` → 0 errors(기존 `seed.ts`의 `NAV.map(...)`이 `children`을 무시해도 타입 OK).
- `npm run lint` → 0 errors.
