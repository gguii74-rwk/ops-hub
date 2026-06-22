# task-03 — seed create-if-absent (트리 부트스트랩)

**목적:** `seed.ts`의 NavigationItem upsert(덮어쓰기) 루프를 **create-if-absent 트리 부트스트랩**으로 교체한다(D3). 로직을 `prisma/seed-navigation.ts`로 추출해 단위테스트한다(`planGoogleSources` 추출 패턴). key 존재 시 skip(편집 보존), 미존재 시 create + 부모→자식 parentId 연결, 권한 미해석 시 fail-closed throw.

## Files

- **Create:** `prisma/seed-navigation.ts` — `seedNavigation()` + `NavWriteClient` 타입.
- **Modify:** `prisma/seed.ts` — step 5 nav 루프를 `seedNavigation` 호출로 교체. 미사용된 `NAV`(flatten)·`splitKey` 제거.
- **Create (test):** `tests/prisma/seed-navigation.test.ts`

## Prep

- 스펙 §5(SSOT·부트스트랩)·결정 D3.
- 엔트리포인트 §Shared Contracts **SC-10**.
- 기존 출처: `prisma/seed.ts:26~32`(NAV flatten·splitKey), `:111~141`(현재 nav upsert 루프), `prisma/seed-google.ts`(추출 helper 선례).
- task-02의 `NavEntry.children`·`NAV` 트리.

## Deps

task-02(NAV 트리 형태).

## Cautions

- **upsert의 `update:{...}` 덮어쓰기를 되살리지 말 것.** create-if-absent의 핵심은 key 존재 시 **어떤 필드도 갱신하지 않는 것**(관리자 편집이 재배포에 보존 — D3). update 분기 자체가 없어야 한다.
- **fail-closed 유지:** 권한 미해석이면 create 전에 throw(null로 두면 공개 누출 — D3/E3). 기존 seed가 지키던 불변식.
- **부모 존재 + 자식 미존재**도 정상 경로다 — 기존 환경에 `메뉴 관리` 자식만 새로 생긴다(부모 `관리`는 보존). 부모가 존재해도 children 재귀는 돈다.
- **P7(depth-3 방지):** children을 가질 entry의 기존 행이 그 사이 reparent돼 `parentId != null`이면, 그 아래 자식을 만들면 depth-3가 된다 → **fail-closed로 throw**(부분 부팅으로 트리 손상 방지). 기존 행은 `{id, parentId}`를 select해 검증한다.
- seed.ts는 `@` alias 대신 상대경로 import(기존 관행) — `./seed-navigation`.

## Step 1 — 실패 테스트: create-if-absent 트리

`tests/prisma/seed-navigation.test.ts` 생성:

```ts
import { describe, it, expect, vi } from "vitest";
import { seedNavigation, type NavWriteClient } from "../../prisma/seed-navigation";
import type { NavEntry } from "@/kernel/access/catalog";

function makeClient(existingKeys: Set<string>) {
  const created: Array<Record<string, unknown>> = [];
  let counter = 0;
  const client: NavWriteClient = {
    navigationItem: {
      findUnique: vi.fn(async ({ where }) =>
        existingKeys.has(where.key) ? { id: `exist-${where.key}`, parentId: null } : null,
      ),
      create: vi.fn(async ({ data }) => {
        created.push(data as Record<string, unknown>);
        return { id: `new-${++counter}` };
      }),
    },
  };
  return { client, created };
}

const tree: NavEntry[] = [
  {
    key: "admin", label: "관리", href: "/admin", permission: "admin.users:view",
    children: [
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
    ],
  },
];

const resolveAll = async (k: string) =>
  ({ "admin.users:view": "p-users", "admin.navigation:view": "p-nav" } as Record<string, string>)[k] ?? null;

describe("seedNavigation (create-if-absent 트리)", () => {
  it("빈 DB: 부모(parentId null) + 자식(parentId=부모 새 id)을 생성", async () => {
    const { client, created } = makeClient(new Set());
    await seedNavigation(client, tree, resolveAll);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      key: "admin", parentId: null, requiredPermissionId: "p-users", sortOrder: 10, href: "/admin",
    });
    expect(created[1]).toMatchObject({
      key: "admin-navigation", parentId: "new-1", requiredPermissionId: "p-nav", sortOrder: 10,
    });
  });

  it("부모 존재 시 부모 skip, 자식은 기존 부모 id로 생성(편집 보존 + 신규 자식)", async () => {
    const { client, created } = makeClient(new Set(["admin"]));
    await seedNavigation(client, tree, resolveAll);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ key: "admin-navigation", parentId: "exist-admin" });
  });

  it("전부 존재 시 아무것도 생성하지 않음(전 필드 보존)", async () => {
    const { client, created } = makeClient(new Set(["admin", "admin-navigation"]));
    await seedNavigation(client, tree, resolveAll);
    expect(created).toHaveLength(0);
  });

  it("권한 미해석이면 throw(fail-closed) — 그 항목은 생성되지 않음", async () => {
    const { client, created } = makeClient(new Set(["admin"])); // 부모는 존재 → 자식만 시도
    const resolveNone = async () => null;
    await expect(seedNavigation(client, tree, resolveNone)).rejects.toThrow(/admin-navigation/);
    expect(created).toHaveLength(0);
  });

  it("P7: 자식을 가질 기존 부모가 top-level이 아니면 throw(depth-3 방지, 자식 생성 안 함)", async () => {
    const created: Array<Record<string, unknown>> = [];
    const client: NavWriteClient = {
      navigationItem: {
        // 기존 'admin'이 reparent되어 parentId != null
        findUnique: vi.fn(async () => ({ id: "exist-admin", parentId: "someParent" })),
        create: vi.fn(async ({ data }) => { created.push(data as Record<string, unknown>); return { id: "x" }; }),
      },
    };
    await expect(seedNavigation(client, tree, resolveAll)).rejects.toThrow(/top-level/);
    expect(created).toHaveLength(0);
  });
});
```

실행: `npm test -- seed-navigation` → **FAIL**(`prisma/seed-navigation.ts` 없음).

## Step 2 — seed-navigation.ts 작성

`prisma/seed-navigation.ts` 생성:

```ts
// 메뉴 트리 부트스트랩 로직(seed.ts에서 추출 — planGoogleSources 패턴). DB 미접속 단위테스트 가능.
// 상대경로 import: tsx의 @ alias 해석 의존 회피(seed.ts 관행).
import type { NavEntry } from "../src/kernel/access/catalog";

// seedNavigation이 호출하는 클라이언트 표면(구조적 최소). 실 PrismaClient·테스트 mock 둘 다 충족.
export interface NavWriteClient {
  navigationItem: {
    findUnique(args: { where: { key: string }; select: { id: true; parentId: true } }): Promise<{ id: string; parentId: string | null } | null>;
    create(args: {
      data: {
        key: string; label: string; href: string; sortOrder: number;
        parentId: string | null; requiredPermissionId: string;
      };
    }): Promise<{ id: string }>;
  };
}

// create-if-absent. key 존재 시 skip(편집 보존 — D3), 없으면 NAV 값으로 create.
// 권한 미해석이면 throw(fail-closed — 공개 누출 방지 — D3/E3). 부모를 먼저 만들고 그 id로
// 자식 parentId를 연결한다(부모가 이미 있어도 자식 재귀는 돈다 → 기존 환경에 신규 자식만 추가).
// sortOrder는 형제 내 (idx+1)*10.
export async function seedNavigation(
  client: NavWriteClient,
  entries: readonly NavEntry[],
  resolvePermissionId: (permissionKey: string) => Promise<string | null>,
  parentId: string | null = null,
): Promise<void> {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let id: string;
    const existing = await client.navigationItem.findUnique({ where: { key: entry.key }, select: { id: true, parentId: true } });
    if (existing) {
      id = existing.id; // 편집 보존: 어떤 필드도 갱신하지 않는다.
      // P7: 자식을 가질 부트스트랩 부모가 그 사이 reparent돼 top-level이 아니게 됐으면, 그 아래 자식 생성은
      // depth-3 위반이다(읽기·관리 경로는 2단만 처리). fail-closed로 중단(부분 부팅으로 트리 손상 방지).
      if (entry.children?.length && existing.parentId !== null) {
        throw new Error(
          `부트스트랩 부모 '${entry.key}'가 더 이상 top-level이 아님(parentId=${existing.parentId}) — 자식 생성 시 depth-2 위반. 중단.`,
        );
      }
    } else {
      const permissionId = await resolvePermissionId(entry.permission);
      if (!permissionId) {
        throw new Error(
          `nav '${entry.key}'의 권한 '${entry.permission}'을 해석하지 못함 — 중단(메뉴가 공개로 새는 것 방지).`,
        );
      }
      const created = await client.navigationItem.create({
        data: {
          key: entry.key, label: entry.label, href: entry.href,
          sortOrder: (i + 1) * 10, parentId, requiredPermissionId: permissionId,
        },
      });
      id = created.id;
    }
    if (entry.children?.length) {
      await seedNavigation(client, entry.children, resolvePermissionId, id);
    }
  }
}
```

실행: `npm test -- seed-navigation` → **PASS**.

## Step 3 — seed.ts 재배선

`prisma/seed.ts`:

1. import 추가:

```ts
import { seedNavigation } from "./seed-navigation";
```

2. **제거**: 미사용이 될 NAV flatten(line 26~27)과 splitKey(line 29~32):

```ts
// (제거) const NAV = NAV_CATALOG.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));
// (제거) function splitKey(key) { ... }
```

3. step 5 전체(현재 `for (const item of NAV) { ... upsert ... }`)를 교체:

```ts
  // 5. NavigationItems — create-if-absent 트리 부트스트랩(D3). key 존재 시 skip(관리자 편집 보존),
  //    미존재 시에만 NAV 값으로 create. 권한 미해석이면 fail-closed throw. 부모→자식 parentId 연결.
  const resolveNavPermissionId = async (key: string) => permissionIdByKey.get(key) ?? null;
  await seedNavigation(prisma, NAV_CATALOG, resolveNavPermissionId);
```

4. 완료 로그의 `nav=${NAV.length}`를 최상위 개수로:

```ts
  console.log(
    `seed 완료: permissions=${defs.size}, roles=${ACCESS_ROLES.length}, nav=${NAV_CATALOG.length}(트리), admin=${email}, calendarSources=seeded`,
  );
```

실행: `npm run typecheck` → 0 errors(미사용 `splitKey`/`NAV` 제거 확인).

## Acceptance Criteria

- `npm test -- seed-navigation` → 5 케이스 PASS(P7 top-level 위반 throw 포함).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors(미사용 심볼 없음).
- `git diff prisma/seed.ts` → step 5만 교체 + import 1 + 로그 1, 그 외 무변경. update 분기 부활 없음.
- (수동·dev) `npm run db:seed` 재실행 시 기존 메뉴 편집이 보존되고 `메뉴 관리` 자식만 신규 생성됨.
