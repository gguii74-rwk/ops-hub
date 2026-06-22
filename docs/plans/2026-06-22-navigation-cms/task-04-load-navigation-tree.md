# task-04 — loadNavigation 트리·관용 가시성

**목적:** 읽기 경로를 평면→2단 트리로 확장한다(D4). `NavNode`에 `children` 추가, 권한 가시성 로직을 순수 함수 `selectVisibleNav`로 추출(관용 컨테이너 규칙 — 부모 권한 실패해도 보이는 자식 있으면 부모 노출), `loadNavigation`은 활성 트리를 로드해 위임한다.

## Files

- **Modify:** `src/kernel/navigation/index.ts` — `NavNode`에 `children`; `selectVisibleNav` export; `loadNavigation` 트리 쿼리.
- **Create (test):** `tests/kernel/navigation/select.test.ts`(순수), `tests/kernel/navigation/load.test.ts`(모킹 prisma).

## Prep

- 스펙 §6(읽기 경로), 결정 D4/D5/D6.
- 엔트리포인트 §Shared Contracts **SC-2**(`NavNode`)·**SC-3**(권한키).
- 기존 출처: `src/kernel/navigation/index.ts`(현재 평면 `loadNavigation`), `tests/modules/leave/repositories.test.ts`(모킹 prisma 패턴).

## Deps

없음(읽기 경로 — FK 변경 무관). task-05가 본 태스크의 `NavNode.children`을 소비.

## Cautions

- **3단 이상 로드 금지(D6):** children의 children은 select하지 않는다(2단만). 자식은 항상 leaf(`children: []`).
- **관용 가시성(D4):** `visible(parent) = ownAllowed(parent) || visibleChildren.length > 0`. 부모 권한이 자식보다 좁아도 자식이 사라지면 안 된다. "빈 부모 숨김"은 이 규칙에 포섭(보이는 자식 0 + 부모 권한 실패 → 숨김).
- **공개(D8):** `requiredPermission == null`이면 ownAllowed=true. 별도 분기 추가 말 것.
- `isActive` 필터는 **쿼리에서** 처리(부모·자식 모두 `isActive: true`). 순수 함수는 이미 활성만 받는다고 가정 — 순수 함수에 isActive 인자를 넣지 말 것(관심사 분리).
- 클라이언트(`AppNav`)엔 권한 정보를 넘기지 않는다 — `NavNode`는 `{key,label,href,children}`만(SC-2).

## Step 1 — 실패 테스트: selectVisibleNav 순수 로직

`tests/kernel/navigation/select.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { selectVisibleNav, type RawNavParent } from "@/kernel/navigation";

const perm = (resource: string, action = "view") => ({ resource, action });

function parent(over: Partial<RawNavParent> & { key: string; sortOrder: number }): RawNavParent {
  return {
    label: over.key, href: `/${over.key}`, requiredPermission: null, children: [],
    ...over,
  };
}

describe("selectVisibleNav (D4 관용 가시성)", () => {
  it("공개 부모(권한 null)는 자식 없어도 노출", () => {
    const out = selectVisibleNav([parent({ key: "dash", sortOrder: 10 })], new Set());
    expect(out).toEqual([{ key: "dash", label: "dash", href: "/dash", children: [] }]);
  });

  it("부모 권한 실패 + 보이는 자식 있으면 부모 노출하되 href=null(그룹 토글 — D5 인코딩)", () => {
    const tree: RawNavParent[] = [parent({
      key: "admin", sortOrder: 50, href: "/admin", requiredPermission: perm("admin.users"),
      children: [
        { key: "nav", label: "메뉴", href: "/admin/navigation", sortOrder: 10, requiredPermission: perm("admin.navigation") },
      ],
    })];
    const out = selectVisibleNav(tree, new Set(["admin.navigation:view"])); // 부모 권한 없음, 자식 권한 있음
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "admin", href: null }); // 자체 권한 실패 → 링크 아님
    expect(out[0].children.map((c) => c.key)).toEqual(["nav"]);
  });

  it("부모 권한 통과 + 자식 전부 실패면 부모 링크(href 유지) + 자식 빈 배열", () => {
    const tree: RawNavParent[] = [parent({
      key: "admin", sortOrder: 50, href: "/admin", requiredPermission: perm("admin.users"),
      children: [{ key: "nav", label: "메뉴", href: "/x", sortOrder: 10, requiredPermission: perm("admin.navigation") }],
    })];
    const out = selectVisibleNav(tree, new Set(["admin.users:view"]));
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe("/admin"); // 자체 권한 통과 → 링크 유지
    expect(out[0].children).toEqual([]);
  });

  it("빈 부모 숨김: 부모 권한 실패 + 보이는 자식 0 → 제외", () => {
    const tree: RawNavParent[] = [parent({
      key: "admin", sortOrder: 50, requiredPermission: perm("admin.users"),
      children: [{ key: "nav", label: "메뉴", href: "/x", sortOrder: 10, requiredPermission: perm("admin.navigation") }],
    })];
    const out = selectVisibleNav(tree, new Set()); // 아무 권한 없음
    expect(out).toEqual([]);
  });

  it("부모·자식 모두 sortOrder로 정렬", () => {
    const tree: RawNavParent[] = [
      parent({ key: "b", sortOrder: 20 }),
      parent({
        key: "a", sortOrder: 10, children: [
          { key: "c2", label: "c2", href: "/c2", sortOrder: 20, requiredPermission: null },
          { key: "c1", label: "c1", href: "/c1", sortOrder: 10, requiredPermission: null },
        ],
      }),
    ];
    const out = selectVisibleNav(tree, new Set());
    expect(out.map((n) => n.key)).toEqual(["a", "b"]);
    expect(out[0].children.map((c) => c.key)).toEqual(["c1", "c2"]);
  });
});
```

실행: `npm test -- navigation/select` → **FAIL**.

## Step 2 — 실패 테스트: loadNavigation 쿼리·위임

`tests/kernel/navigation/load.test.ts` 생성:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const db = { navigationItem: { findMany: vi.fn() } };
  return { db, prisma: db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { loadNavigation } from "@/kernel/navigation";

beforeEach(() => vi.clearAllMocks());

describe("loadNavigation (트리 쿼리 + 위임)", () => {
  it("활성 최상위 + 활성 children을 로드하고 권한 필터를 적용", async () => {
    h.db.navigationItem.findMany.mockResolvedValue([
      {
        key: "admin", label: "관리", href: "/admin", sortOrder: 50,
        requiredPermission: { resource: "admin.users", action: "view" },
        children: [
          { key: "nav", label: "메뉴 관리", href: "/admin/navigation", sortOrder: 10, requiredPermission: { resource: "admin.navigation", action: "view" } },
        ],
      },
    ]);
    const out = await loadNavigation(["admin.navigation:view"]); // 부모 권한 없음 → 관용 노출 + href=null
    expect(out).toEqual([
      { key: "admin", label: "관리", href: null, children: [
        { key: "nav", label: "메뉴 관리", href: "/admin/navigation", children: [] },
      ] },
    ]);
    const arg = h.db.navigationItem.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ isActive: true, parentId: null });
    expect(arg.select.children.where).toEqual({ isActive: true });
  });
});
```

실행: `npm test -- navigation/load` → **FAIL**.

## Step 3 — kernel/navigation/index.ts 재작성

`src/kernel/navigation/index.ts` 전체 교체:

```ts
import { prisma } from "@/lib/prisma";

// 클라이언트(AppNav) 계약 — 권한 필터는 서버에서 끝났으므로 권한 정보를 넘기지 않는다(SC-2).
export interface NavNode {
  key: string;
  label: string;
  href: string | null;
  children: NavNode[];
}

// 로드된 트리(권한키 포함, 가시성 판정용). isActive는 쿼리에서 이미 필터됨.
export interface RawNavLeaf {
  key: string;
  label: string;
  href: string | null;
  sortOrder: number;
  requiredPermission: { resource: string; action: string } | null;
}
export interface RawNavParent extends RawNavLeaf {
  children: RawNavLeaf[];
}

// 관용 가시성(D4): 부모는 (자체 권한 통과) OR (보이는 자식 ≥ 1)이면 노출. 자식은 leaf(2단 — D6).
// 공개(requiredPermission == null)는 항상 통과(D8). 부모·자식 모두 sortOrder로 정렬.
export function selectVisibleNav(parents: RawNavParent[], allowedKeys: Set<string>): NavNode[] {
  const ownAllowed = (n: RawNavLeaf): boolean =>
    n.requiredPermission == null ||
    allowedKeys.has(`${n.requiredPermission.resource}:${n.requiredPermission.action}`);

  return parents
    .map((p) => {
      const children: NavNode[] = [...p.children]
        .filter(ownAllowed)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ key: c.key, label: c.label, href: c.href, children: [] as NavNode[] }));
      return { p, children };
    })
    .filter(({ p, children }) => ownAllowed(p) || children.length > 0)
    .sort((a, b) => a.p.sortOrder - b.p.sortOrder)
    // D5 인코딩: 자체 권한 통과 시에만 href를 링크로 유지, 관용으로만 노출되는 부모는 href=null(그룹 토글).
    .map(({ p, children }) => ({ key: p.key, label: p.label, href: ownAllowed(p) ? p.href : null, children }));
}

// 활성 2단 트리를 로드해 허용 키로 필터(관용)·정렬 반환.
export async function loadNavigation(allowedKeys: string[]): Promise<NavNode[]> {
  const items = await prisma.navigationItem.findMany({
    where: { isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      key: true,
      label: true,
      href: true,
      sortOrder: true,
      requiredPermission: { select: { resource: true, action: true } },
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          key: true,
          label: true,
          href: true,
          sortOrder: true,
          requiredPermission: { select: { resource: true, action: true } },
        },
      },
    },
  });
  return selectVisibleNav(items as RawNavParent[], new Set(allowedKeys));
}
```

실행: `npm test -- navigation/select navigation/load` → **PASS**.

## Acceptance Criteria

- `npm test -- navigation/select navigation/load` → 전부 PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors.
- `src/app/(app)/layout.tsx`는 무수정 — `loadNavigation`이 여전히 `NavNode[]`를 반환(이제 children 포함). 소비 타입 흐름은 task-05에서 `AppNav`가 받는다.
