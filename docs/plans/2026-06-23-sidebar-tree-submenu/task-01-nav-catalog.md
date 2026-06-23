# Task 01 — NAV 카탈로그 트리 확장 + 구조 테스트

연차에 5자식, 관리에 `사용자 관리` 자식을 `NAV` 부트스트랩 카탈로그에 추가하고, 구조를 고정하는 단위 테스트를 둔다. (데이터만 — 마이그레이션·권한 변경 없음.)

## Files

- Modify: `src/kernel/access/catalog.ts` — `NAV` 배열(현재 36~47행)
- Create: `tests/kernel/access/nav-catalog.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **C1**(NavEntry), **C2**(NAV 최종 형태) 숙지.
- spec `docs/specs/2026-06-23-sidebar-tree-submenu-design.md` D2·D3·D6·D10.
- 배경: `src/kernel/access/catalog.ts`의 `RESOURCES`/`ACTIONS`에 본 태스크가 쓰는 권한 키가 **이미 전부 존재**(새 권한 없음). `prisma/seed-navigation.ts`가 create-if-absent로 이 배열을 적재(재시드 시 신규 자식만 추가).

## Deps

없음.

## Steps

### 1. 구조 테스트 먼저 작성(실패 확인)

`tests/kernel/access/nav-catalog.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { NAV, RESOURCES, ACTIONS, type NavEntry } from "@/kernel/access/catalog";

const byKey = (entries: readonly NavEntry[], key: string) => {
  const found = entries.find((e) => e.key === key);
  if (!found) throw new Error(`NAV에 '${key}' 없음`);
  return found;
};

describe("NAV 카탈로그 트리 구조", () => {
  it("연차(leave) 자식 5개 — 순서·href·권한 고정", () => {
    const leave = byKey(NAV, "leave");
    expect(leave.href).toBe("/leave");
    expect(leave.permission).toBe("leave.request:view");
    expect((leave.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["leave-dashboard", "/leave", "leave.request:view"],
      ["leave-request", "/leave/request", "leave.request:create"],
      ["leave-calendar", "/leave/calendar", "leave.request:view"],
      ["leave-history", "/leave/history", "leave.request:view"],
      ["leave-manage", "/leave/manage", "leave.approval:view"],
    ]);
  });

  it("관리(admin) 자식 2개 — 사용자 관리 먼저, 메뉴 관리 다음", () => {
    const admin = byKey(NAV, "admin");
    expect((admin.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["admin-users", "/admin/users", "admin.users:view"],
      ["admin-navigation", "/admin/navigation", "admin.navigation:view"],
    ]);
  });

  it("모든 NAV 권한 키가 카탈로그(RESOURCES×ACTIONS)에 존재 — 새 권한 없음", () => {
    const resources = new Set<string>(RESOURCES);
    const actions = new Set<string>(ACTIONS);
    const walk = (entries: readonly NavEntry[]): void => {
      for (const e of entries) {
        const [resource, action] = e.permission.split(":");
        expect(resources.has(resource), `resource '${resource}'`).toBe(true);
        expect(actions.has(action), `action '${action}'`).toBe(true);
        if (e.children?.length) walk(e.children);
      }
    };
    walk(NAV);
  });

  it("깊이 2단 — 자식의 자식 없음", () => {
    for (const top of NAV) {
      for (const child of top.children ?? []) {
        expect(child.children ?? [], `${child.key}는 leaf여야 함`).toHaveLength(0);
      }
    }
  });
});
```

실행(아직 `NAV` 미변경 → 연차/관리 자식 기대 불일치로 FAIL 예상):

```
npm test -- tests/kernel/access/nav-catalog.test.ts
```

### 2. `NAV` 확장(구현)

`src/kernel/access/catalog.ts`의 `NAV` 배열(현재 leave는 자식 없음, admin은 `admin-navigation` 1자식)을 엔트리포인트 §Shared Contracts **C2**의 배열로 교체한다. 정확한 최종 형태:

```ts
export const NAV: readonly NavEntry[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar", label: "캘린더", href: "/calendar", permission: "calendar.work:view" },
  { key: "workflows", label: "업무", href: "/workflows", permission: "workflows.weekly:view" },
  {
    key: "leave", label: "연차", href: "/leave", permission: "leave.request:view",
    children: [
      { key: "leave-dashboard", label: "대시보드", href: "/leave", permission: "leave.request:view" },
      { key: "leave-request", label: "연차 신청", href: "/leave/request", permission: "leave.request:create" },
      { key: "leave-calendar", label: "캘린더", href: "/leave/calendar", permission: "leave.request:view" },
      { key: "leave-history", label: "연차 내역", href: "/leave/history", permission: "leave.request:view" },
      { key: "leave-manage", label: "연차 관리", href: "/leave/manage", permission: "leave.approval:view" },
    ],
  },
  {
    key: "admin", label: "관리", href: "/admin", permission: "admin.users:view",
    children: [
      { key: "admin-users", label: "사용자 관리", href: "/admin/users", permission: "admin.users:view" },
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
    ],
  },
] as const;
```

윗부분의 카탈로그 의미 주석(34~35행 "초기 부트스트랩 시드 데이터…")은 그대로 둔다.

### 3. 통과 확인

```
npm test -- tests/kernel/access/nav-catalog.test.ts
```
→ 4개 케이스 PASS.

### 4. 커밋

```
git add "src/kernel/access/catalog.ts" tests/kernel/access/nav-catalog.test.ts
git commit -m "feat(nav): NAV 카탈로그에 연차 5자식·관리 사용자관리 자식 추가"
```

## Acceptance Criteria

```
npm test -- tests/kernel/access/nav-catalog.test.ts   # 4 passed
npm run typecheck                                      # 에러 0
npm test                                               # 전체 그린(seed-navigation 기존 테스트 영향 없음)
```

## Cautions

- **권한 키를 새로 만들지 말 것.** 이유: 권한 카탈로그는 코드 진실원이며 본 스펙은 기존 권한 **재사용만**(spec OUT). 모든 `permission` 값은 `RESOURCES`×`ACTIONS` 조합에 이미 존재.
- **기존 부트스트랩 key를 바꾸지 말 것**(`admin-navigation` 등). 이유: 재시드는 key로 create-if-absent — key를 바꾸면 기존 항목을 못 찾아 중복 생성·편집 유실.
- **3단(자식의 자식) 만들지 말 것.** 이유: 읽기·관리 경로는 2단만 처리(상위 스펙 D6), 시드 depth-3 가드가 throw.
- 라벨에 식별자(영어 key)와 표시명(한국어) 혼동 금지 — `key`는 영어 슬러그, `label`은 한국어.
