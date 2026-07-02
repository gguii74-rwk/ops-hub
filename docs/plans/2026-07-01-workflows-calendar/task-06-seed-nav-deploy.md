# Task 06 — 시드·권한·nav 배포 (EXTRA/ROLE_ALLOW·WorkflowType·nav flip·upgrade 2종)

fresh/existing install 패리티로 신규 kind 권한을 배포한다: client `create` 권한 카탈로그, `ROLE_ALLOW` grant(client view + 집계 `workflows:view`), 생성 가능한 kind의 `WorkflowType` 행(prod 갭 폐쇄), nav rename+게이팅 flip(D11·D13), upgrade-once 헬퍼 2종(기존 DB reconcile).

## Files
- Modify: `prisma/seed-permissions.ts` (`EXTRA_PERMISSIONS` += client create 2)
- Modify: `prisma/seed-roles.ts` (`ROLE_ALLOW` grant)
- Modify: `src/kernel/access/catalog.ts` (`NAV` workflows 부모·workflows-list 자식 flip)
- Modify: `prisma/seed.ts` (WorkflowType 4행 + upgrade 2종 wiring, 순서 중요)
- Create: `prisma/migrate-helpers/workflows-view-upgrade.ts`
- Create: `prisma/migrate-helpers/workflows-nav-reconcile.ts`
- Test: `tests/kernel/access/nav-catalog.test.ts` (workflows flip 반영)
- Test: `tests/kernel/navigation/workflows-nav-visibility.test.ts` (신규 — R3 집계 게이팅)
- Test: `tests/prisma/workflows-view-roles.test.ts` (신규 — ROLE_ALLOW 불변식)
- Test: `tests/prisma/workflows-view-upgrade.test.ts` (신규 — 헬퍼)
- Test: `tests/prisma/workflows-nav-reconcile.test.ts` (신규 — 헬퍼)

## Prep
- 엔트리포인트 §Shared Contracts SC-10(권한·리소스·시드), SC-11(WorkflowType), SC-12(nav flip + 헬퍼 + seed 순서).
- 참조: `prisma/migrate-helpers/billing-create-upgrade.ts`·`leave-notifications-upgrade.ts`(upgrade-once 패턴·fail-closed), `tests/prisma/billing-create-upgrade.test.ts`(테스트 관례), `prisma/seed.ts`(BILLING WorkflowType upsert·upgrade wiring), `prisma/seed-navigation.ts`(create-if-absent=편집보존).
- Task 01이 `RESOURCES`에 `workflows`/`workflows.weeklyClient`/`workflows.monthlyClient`를 이미 추가했다(→ `…:view` 자동 생성).
- D11·D13, R5·F1(bootstrap이 빈 role만 채움 → 기존 role은 upgrade-once로 grant, nav flip 전 실행).

## Deps
- Task 01(`RESOURCES` 3종 추가, `KIND_RESOURCE`).

## Cautions
- **Don't nav flip을 grant보다 먼저 하지 마라.** `applyWorkflowsViewUpgrade`(grant) → seedNavigation → `applyWorkflowsNavReconcile`(flip) 순. 반대면 기존 notification/billing-only role이 메뉴를 잃는다(R5·F1).
- **Don't `seed-roles.ts` 편집만으로 기존 DB가 grant될 거라 기대하지 마라.** `bootstrapRolePermissions`는 `RolePermission` 행이 0일 때만 시드(기존 DB skip). 기존 DB는 `applyWorkflowsViewUpgrade`가 reconcile.
- **Don't `WorkflowType`을 client 2행만 seed하지 마라.** 메인 seed엔 `BILLING`만 있고 `WEEKLY_REPORT`/`NOTIFICATION_BILLING`은 seed-demo(dev)에만 있다 → 일반화 모달이 offer하는 create가 prod에서 403. 생성 가능한 나머지 **4종 전부** upsert(SC-11).
- **Don't upgrade 헬퍼 플래그를 upsert 전에 set하지 마라.** fail-closed: 전제(권한 존재) 미충족 시 throw로 플래그 미설정 → 다음 seed 재시도.
- **Don't nav reconcile을 매 seed마다 재실행되게 하지 마라.** 플래그로 1회 보장(이후 admin이 CMS로 라벨 자유 편집 — re-clobber 방지).
- **Don't 헬퍼 client 표면을 넓히지 마라.** teams-upgrade `UpgradeClient` 동형의 최소 구조적 인터페이스(mock·PrismaTx 둘 다 충족). `prisma.$transaction((tx) => applyX(tx, …))`에서 PrismaTx가 구조적으로 충족한다(기존 upsert 헬퍼와 동일 패턴). `findMany`는 `select:{roleId:true}` 반환이 `Array<{roleId:string}>`와 일치 — 만약 typecheck가 PrismaTx↔인터페이스 불일치를 낸다면 select 반환 형만 맞추면 된다(신규 캐스팅 도입 금지).

## TDD Steps

### 1. EXTRA_PERMISSIONS — client create

`prisma/seed-permissions.ts`의 배열에 workflows 블록 뒤(8행 `["leave.request","create"]` 앞)에 추가:

```ts
  ["workflows.weeklyClient", "create"], ["workflows.monthlyClient", "create"],
```

(view 권한은 `RESOURCES`(task 01)에서 seed VIEW_RESOURCES 루프가 자동 생성 — `workflows.weeklyClient:view`·`workflows.monthlyClient:view`·`workflows:view`.)

### 2. ROLE_ALLOW grant — 실패 테스트 먼저

`tests/prisma/workflows-view-roles.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { ROLE_ALLOW, type Cell } from "../../prisma/seed-roles";
import { KIND_RESOURCE } from "../../src/modules/workflows/policy";

const KIND_VIEW_KEYS = Object.values(KIND_RESOURCE).map((r) => `${r}:view`);
const has = (cells: Cell[], key: string) => cells.some((c) => (Array.isArray(c) ? c[0] === key : c === key));
const hasStar = (cells: Cell[]) => cells.includes("*");

describe("ROLE_ALLOW — workflows:view 집계 동반(D13, fresh 패리티)", () => {
  it("임의 kind view 보유 role은 workflows:view도 보유", () => {
    for (const [role, cells] of Object.entries(ROLE_ALLOW)) {
      if (hasStar(cells)) continue; // "*"는 전부(pm)
      if (KIND_VIEW_KEYS.some((k) => has(cells, k))) {
        expect(has(cells, "workflows:view"), `${role}에 workflows:view 필요`).toBe(true);
      }
    }
  });

  it("regular/contractor-developer/contractor-content는 client kind view 보유", () => {
    for (const role of ["regular-developer", "contractor-developer", "contractor-content"]) {
      expect(has(ROLE_ALLOW[role], "workflows.weeklyClient:view")).toBe(true);
      expect(has(ROLE_ALLOW[role], "workflows.monthlyClient:view")).toBe(true);
    }
  });

  it("contractor-civil-response는 workflows:view 보유(메뉴 노출), client view는 없음", () => {
    expect(has(ROLE_ALLOW["contractor-civil-response"], "workflows:view")).toBe(true);
    expect(has(ROLE_ALLOW["contractor-civil-response"], "workflows.weeklyClient:view")).toBe(false);
  });

  it("위임 admin은 workflows 권한 0(workflows:view 미보유)", () => {
    expect(has(ROLE_ALLOW.admin, "workflows:view")).toBe(false);
  });
});
```

실행: `npm test -- tests/prisma/workflows-view-roles.test.ts` → **FAIL**.

구현 — `prisma/seed-roles.ts`의 해당 role 배열에 항목 추가:

`"regular-developer"`(19~25행)의 배열 끝에:
```ts
    "workflows.weeklyClient:view", "workflows.monthlyClient:view", "workflows:view",
```
`"contractor-developer"`(26~30행) 끝에:
```ts
    "workflows.weeklyClient:view", "workflows.monthlyClient:view", "workflows:view",
```
`"contractor-content"`(31~35행) 끝에:
```ts
    "workflows.weeklyClient:view", "workflows.monthlyClient:view", "workflows:view",
```
`"contractor-civil-response"`(36~40행) 끝에:
```ts
    "workflows:view",
```

(`pm: ["*"]`는 자동 전부 — client view+create·`workflows:view` 포함. `admin`은 불변.)

실행: `npm test -- tests/prisma/workflows-view-roles.test.ts` → **PASS**.

### 3. workflows-view-upgrade 헬퍼 — 실패 테스트 먼저

`tests/prisma/workflows-view-upgrade.test.ts` 생성:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyWorkflowsViewUpgrade, WORKFLOWS_VIEW_KEY } from "../../prisma/migrate-helpers/workflows-view-upgrade";

const KIND_VIEW_KEYS = ["workflows.weekly:view", "workflows.notification:view", "workflows.billing:view", "workflows.weeklyClient:view", "workflows.monthlyClient:view"];
function permMap() {
  const m = new Map<string, string>();
  m.set(WORKFLOWS_VIEW_KEY, "perm-agg");
  KIND_VIEW_KEYS.forEach((k, i) => m.set(k, `perm-${i}`));
  return m;
}
function mkDb(flagExists: boolean, roleRows: Array<{ roleId: string }>) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: {
      findMany: vi.fn(async () => roleRows),
      upsert: vi.fn(async () => ({})),
    },
  };
}

describe("applyWorkflowsViewUpgrade (D13 — 기존 role reconcile)", () => {
  it("임의 kind view 보유 role(중복 제거)에 workflows:view grant + 플래그", async () => {
    const db = mkDb(false, [{ roleId: "r1" }, { roleId: "r1" }, { roleId: "r2" }]);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(true);
    expect(r.grantedRoleCount).toBe(2);
    const ids = db.rolePermission.upsert.mock.calls.map((c: any) => c[0].where.roleId_permissionId_scope.roleId);
    expect(new Set(ids)).toEqual(new Set(["r1", "r2"]));
    for (const c of db.rolePermission.upsert.mock.calls) {
      expect((c[0] as any).create.permissionId).toBe("perm-agg");
    }
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("kind view 보유 role 없으면 grant 0 + 플래그 set(멱등)", async () => {
    const db = mkDb(false, []);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("플래그 있으면 no-op", async () => {
    const db = mkDb(true, [{ roleId: "r1" }]);
    const r = await applyWorkflowsViewUpgrade(db as never, permMap(), KIND_VIEW_KEYS);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.findMany).not.toHaveBeenCalled();
  });

  it("workflows:view 권한 미존재 → throw + 플래그 미설정", async () => {
    const db = mkDb(false, []);
    const m = permMap(); m.delete(WORKFLOWS_VIEW_KEY);
    await expect(applyWorkflowsViewUpgrade(db as never, m, KIND_VIEW_KEYS)).rejects.toThrow(/workflows:view/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
```

실행: `npm test -- tests/prisma/workflows-view-upgrade.test.ts` → **FAIL**(파일 없음).

구현 — `prisma/migrate-helpers/workflows-view-upgrade.ts` 생성:

```ts
// 신규 집계 workflows:view(D13)는 nav 게이팅 전용. fresh install은 ROLE_ALLOW로 grant하지만, bootstrap을 건너뛰는
// 기존 DB(RolePermission count>0)는 grant를 못 받아 nav flip 시 메뉴를 잃는다. 이 헬퍼가 임의 workflows.<kind>:view 보유
// role에 workflows:view를 1회 멱등 reconcile한다(dynamic — 고정 role 아님. CMS 커스텀 role도 커버).
export interface WorkflowsViewUpgradeClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  rolePermission: {
    findMany(a: { where: { permissionId: { in: string[] }; effect: "ALLOW" }; select: { roleId: true } }): Promise<Array<{ roleId: string }>>;
    upsert(a: {
      where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } };
      update: Record<string, never>;
      create: { roleId: string; permissionId: string; effect: "ALLOW"; scope: string };
    }): Promise<unknown>;
  };
}

export const WORKFLOWS_VIEW_UPGRADE_FLAG = "migration.workflows-view.upgrade.applied";
export const WORKFLOWS_VIEW_KEY = "workflows:view";

// permissionIdByKey: seed가 채운 맵. kindViewKeys: workflows.<kind>:view 키 배열(seed가 KIND_RESOURCE에서 파생).
// fail-closed: 집계/kind view 권한 중 하나라도 없으면 throw(플래그 미설정 → 다음 seed 재시도). 플래그는 모든 upsert 성공 후에만.
export async function applyWorkflowsViewUpgrade(
  db: WorkflowsViewUpgradeClient,
  permissionIdByKey: Map<string, string>,
  kindViewKeys: string[],
): Promise<{ applied: boolean; grantedRoleCount: number }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_VIEW_UPGRADE_FLAG } });
  if (already) return { applied: false, grantedRoleCount: 0 };
  const aggId = permissionIdByKey.get(WORKFLOWS_VIEW_KEY);
  if (!aggId) throw new Error(`workflows-view-upgrade: 권한 '${WORKFLOWS_VIEW_KEY}' 미존재 — 플래그 미설정, 재시도`);
  const kindViewIds = kindViewKeys.map((k) => {
    const id = permissionIdByKey.get(k);
    if (!id) throw new Error(`workflows-view-upgrade: 권한 '${k}' 미존재 — 플래그 미설정, 재시도`);
    return id;
  });
  const rows = await db.rolePermission.findMany({
    where: { permissionId: { in: kindViewIds }, effect: "ALLOW" },
    select: { roleId: true },
  });
  const roleIds = [...new Set(rows.map((r) => r.roleId))];
  for (const roleId of roleIds) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId_scope: { roleId, permissionId: aggId, scope: "all" } },
      update: {},
      create: { roleId, permissionId: aggId, effect: "ALLOW", scope: "all" },
    });
  }
  await db.systemSetting.create({
    data: { key: WORKFLOWS_VIEW_UPGRADE_FLAG, value: { appliedAt: "bootstrap", roleCount: roleIds.length } },
  });
  return { applied: true, grantedRoleCount: roleIds.length };
}
```

실행: `npm test -- tests/prisma/workflows-view-upgrade.test.ts` → **PASS**.

### 4. workflows-nav-reconcile 헬퍼 — 실패 테스트 먼저

`tests/prisma/workflows-nav-reconcile.test.ts` 생성:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyWorkflowsNavReconcile } from "../../prisma/migrate-helpers/workflows-nav-reconcile";

function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    navigationItem: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
}

describe("applyWorkflowsNavReconcile (D11·D13 — 기존 nav flip)", () => {
  it("workflows 부모(권한만)·workflows-list 자식(label+권한) 교정 + 플래그", async () => {
    const db = mkDb(false);
    const r = await applyWorkflowsNavReconcile(db as never, "perm-agg");
    expect(r.applied).toBe(true);
    const calls = db.navigationItem.updateMany.mock.calls.map((c: any) => c[0]);
    // 부모: 권한만
    expect(calls).toContainEqual({ where: { key: "workflows" }, data: { requiredPermissionId: "perm-agg" } });
    // 자식: label "캘린더" + 권한
    expect(calls).toContainEqual({ where: { key: "workflows-list" }, data: { label: "캘린더", requiredPermissionId: "perm-agg" } });
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("플래그 있으면 no-op(admin CMS 라벨 편집 보존)", async () => {
    const db = mkDb(true);
    const r = await applyWorkflowsNavReconcile(db as never, "perm-agg");
    expect(r.applied).toBe(false);
    expect(db.navigationItem.updateMany).not.toHaveBeenCalled();
  });

  it("workflows:view 권한 id 없음 → throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyWorkflowsNavReconcile(db as never, undefined)).rejects.toThrow(/workflows:view/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
```

실행: `npm test -- tests/prisma/workflows-nav-reconcile.test.ts` → **FAIL**(파일 없음).

구현 — `prisma/migrate-helpers/workflows-nav-reconcile.ts` 생성:

```ts
// nav rename(D11) + 게이팅 flip(D13). seedNavigation은 편집보존(create-if-absent)이라 기존 nav 행을 갱신하지 않는다.
// 이 헬퍼가 기존 DB의 workflows 부모·workflows-list 자식을 1회 교정: 자식 label("업무 목록"→"캘린더") + 두 행 requiredPermissionId(→workflows:view).
// flag로 1회 보장(이후 admin이 CMS로 라벨 자유 편집 — re-clobber 방지). applyWorkflowsViewUpgrade **이후** 실행(grant 먼저, R5·F1).
export interface WorkflowsNavReconcileClient {
  systemSetting: {
    findUnique(a: { where: { key: string } }): Promise<{ key: string } | null>;
    create(a: { data: { key: string; value: unknown } }): Promise<unknown>;
  };
  navigationItem: {
    updateMany(a: { where: { key: string }; data: { label?: string; requiredPermissionId: string } }): Promise<{ count: number }>;
  };
}

export const WORKFLOWS_NAV_RECONCILE_FLAG = "migration.workflows-nav.reconcile.applied";

// workflowsViewPermissionId: seed의 permissionIdByKey.get("workflows:view"). 없으면 throw(fail-closed — 공개 누출 방지).
export async function applyWorkflowsNavReconcile(
  db: WorkflowsNavReconcileClient,
  workflowsViewPermissionId: string | undefined,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_NAV_RECONCILE_FLAG } });
  if (already) return { applied: false };
  if (!workflowsViewPermissionId) {
    throw new Error("workflows-nav-reconcile: 'workflows:view' 권한 미존재 — 플래그 미설정, 재시도");
  }
  // 부모 workflows: 권한만 flip(label "업무" 유지). 자식 workflows-list: label→"캘린더" + 권한 flip.
  await db.navigationItem.updateMany({ where: { key: "workflows" }, data: { requiredPermissionId: workflowsViewPermissionId } });
  await db.navigationItem.updateMany({ where: { key: "workflows-list" }, data: { label: "캘린더", requiredPermissionId: workflowsViewPermissionId } });
  await db.systemSetting.create({ data: { key: WORKFLOWS_NAV_RECONCILE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
```

실행: `npm test -- tests/prisma/workflows-nav-reconcile.test.ts` → **PASS**.

### 5. catalog NAV flip — nav-catalog 테스트 갱신 먼저

`tests/kernel/access/nav-catalog.test.ts`의 `it("업무(workflows) 자식 2개 …")`(49~57행)를 교체:

```ts
  it("업무(workflows) 자식 2개 — 캘린더(index)·대금청구 설정, 게이팅=집계 workflows:view", () => {
    const wf = byKey(NAV, "workflows");
    expect(wf.href).toBe("/workflows");
    expect(wf.permission).toBe("workflows:view");
    expect((wf.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["workflows-list", "/workflows", "workflows:view"],
      ["workflows-billing-settings", "/workflows/billing/settings", "workflows.billing:configure"],
    ]);
  });
```

실행: `npm test -- tests/kernel/access/nav-catalog.test.ts` → **FAIL**(카탈로그 미변경).

구현 — `src/kernel/access/catalog.ts`의 `NAV` workflows 블록(39~46행)을 교체:

```ts
  {
    key: "workflows", label: "업무", href: "/workflows", permission: "workflows:view",
    children: [
      // index 자식: 부모(업무) 클릭 시 캘린더로. label rename(D11)·게이팅=집계 workflows:view(D13).
      { key: "workflows-list", label: "캘린더", href: "/workflows", permission: "workflows:view" },
      { key: "workflows-billing-settings", label: "대금청구 설정", href: "/workflows/billing/settings", permission: "workflows.billing:configure" },
    ],
  },
```

실행: `npm test -- tests/kernel/access/nav-catalog.test.ts` → **PASS**(“모든 NAV 권한 키가 카탈로그에 존재” 테스트도 통과 — task 01이 `workflows` 리소스 추가).

### 5b. R3 — nav 가시성 회귀(집계 게이팅 메커니즘, D13)

`selectVisibleNav`(kernel/navigation)는 도메인-무관(단일 `resource:action` 검사)으로 **불변**. 집계 게이팅이 실제로 성립하는지 회귀로 못박는다. `tests/kernel/navigation/workflows-nav-visibility.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { selectVisibleNav, type RawNavParent } from "@/kernel/navigation";

// 배포 후 DB nav를 모사한 workflows 트리(부모=집계 workflows:view, index 자식=캘린더/집계, 설정 자식=billing:configure).
const parent = (): RawNavParent => ({
  key: "workflows", label: "업무", href: "/workflows", sortOrder: 30,
  requiredPermission: { resource: "workflows", action: "view" },
  children: [
    { key: "workflows-list", label: "캘린더", href: "/workflows", sortOrder: 10, requiredPermission: { resource: "workflows", action: "view" } },
    { key: "workflows-billing-settings", label: "대금청구 설정", href: "/workflows/billing/settings", sortOrder: 20, requiredPermission: { resource: "workflows.billing", action: "configure" } },
  ],
});

describe("selectVisibleNav — workflows 집계 게이팅(D13)", () => {
  it("workflows:view 보유 → 부모+캘린더 자식 노출(href 유지)", () => {
    const out = selectVisibleNav([parent()], new Set(["workflows:view"]));
    const wf = out.find((n) => n.key === "workflows");
    expect(wf).toBeTruthy();
    expect(wf!.href).toBe("/workflows");
    expect(wf!.children.map((c) => c.key)).toContain("workflows-list");
  });

  it("workflows.notification:view만(집계 없음) → 메뉴 숨김(D13 핵심 — kind view만으론 노출 안 됨)", () => {
    const out = selectVisibleNav([parent()], new Set(["workflows.notification:view"]));
    expect(out.find((n) => n.key === "workflows")).toBeUndefined();
  });

  it("권한 없음 → 숨김", () => {
    expect(selectVisibleNav([parent()], new Set()).find((n) => n.key === "workflows")).toBeUndefined();
  });

  it("billing:configure만 → 부모 관용 노출(설정 자식만), href=null(자체 권한 없음, D5)", () => {
    const out = selectVisibleNav([parent()], new Set(["workflows.billing:configure"]));
    const wf = out.find((n) => n.key === "workflows");
    expect(wf).toBeTruthy();
    expect(wf!.href).toBeNull();
    expect(wf!.children.map((c) => c.key)).toEqual(["workflows-billing-settings"]);
  });
});
```

실행: `npm test -- tests/kernel/navigation/workflows-nav-visibility.test.ts` → **PASS**(selectVisibleNav 무변경 — 집계 키를 실제 permission으로 표현해 any-of 하드코딩 회피가 성립함을 증명).

### 6. seed.ts wiring — WorkflowType 4행 + upgrade 2종(순서 중요)

`prisma/seed.ts` 상단 import에 추가(9~12행 부근):

```ts
import { applyWorkflowsViewUpgrade } from "./migrate-helpers/workflows-view-upgrade";
import { applyWorkflowsNavReconcile } from "./migrate-helpers/workflows-nav-reconcile";
import { KIND_RESOURCE } from "../src/modules/workflows/policy";
```

**(a) grant 먼저** — 기존 upgrade 블록 뒤(3e billing-create 다음, 75행 뒤)에 추가:

```ts
  // 3f. 업그레이드-once(D13) — 기존 DB에서 임의 workflows.<kind>:view 보유 role에 집계 workflows:view를 reconcile.
  //     nav flip(5b)보다 **먼저** 실행(안 그러면 기존 notification/billing-only role이 메뉴 상실, R5·F1).
  const workflowsKindViewKeys = Object.values(KIND_RESOURCE).map((r) => `${r}:view`);
  await prisma.$transaction((tx) => applyWorkflowsViewUpgrade(tx, permissionIdByKey, workflowsKindViewKeys));
```

**(b) WorkflowType 4행** — BILLING upsert 블록 뒤(86행 뒤)에 추가:

```ts
  // 3g. WorkflowType — 생성 가능한 나머지 kind(주간보고 본부/알림톡청구/고객사 주간·월간). kind 기준 upsert(멱등).
  //     메인 seed엔 BILLING만 있어 일반화 모달이 offer하는 create가 prod에서 403이 되던 갭을 폐쇄(SC-11).
  //     templatePath=플레이스홀더(생성기 없어 미판독). seed-demo(dev)의 kind 충돌 없음(upsert by kind).
  await prisma.workflowType.upsert({
    where: { kind: "WEEKLY_REPORT" },
    update: { name: "주간보고(본부)", templatePath: "Template/주간보고-본부", recurrence: "weekly" },
    create: { id: "weekly-report", kind: "WEEKLY_REPORT", name: "주간보고(본부)", templatePath: "Template/주간보고-본부", recurrence: "weekly", isActive: true },
  });
  await prisma.workflowType.upsert({
    where: { kind: "NOTIFICATION_BILLING" },
    update: { name: "알림톡청구", templatePath: "Template/알림톡청구", recurrence: "monthly" },
    create: { id: "notification-billing", kind: "NOTIFICATION_BILLING", name: "알림톡청구", templatePath: "Template/알림톡청구", recurrence: "monthly", isActive: true },
  });
  await prisma.workflowType.upsert({
    where: { kind: "WEEKLY_REPORT_CLIENT" },
    update: { name: "주간보고(고객사)", templatePath: "Template/주간보고-고객사", recurrence: "weekly" },
    create: { id: "weekly-report-client", kind: "WEEKLY_REPORT_CLIENT", name: "주간보고(고객사)", templatePath: "Template/주간보고-고객사", recurrence: "weekly", isActive: true },
  });
  await prisma.workflowType.upsert({
    where: { kind: "MONTHLY_REPORT_CLIENT" },
    update: { name: "월간보고(고객사)", templatePath: "Template/월간보고-고객사", recurrence: "monthly" },
    create: { id: "monthly-report-client", kind: "MONTHLY_REPORT_CLIENT", name: "월간보고(고객사)", templatePath: "Template/월간보고-고객사", recurrence: "monthly", isActive: true },
  });
```

**(c) nav flip 마지막** — `seedNavigation(...)` 호출 뒤(124행 뒤)에 추가:

```ts
  // 5b. nav rename+게이팅 flip(D11·D13) — seedNavigation은 편집보존이라 기존 행 미갱신. 1회 멱등 reconcile.
  //     3f grant 이후에 실행되어야 함(순서 보장 — grant→flip).
  await prisma.$transaction((tx) => applyWorkflowsNavReconcile(tx, permissionIdByKey.get("workflows:view")));
```

### 7. 커밋

```bash
npm run typecheck && npm run lint && npm test
```
기대: 전부 green(전체 스위트). 이후 커밋.

## Acceptance Criteria
- `npm run typecheck` → 통과.
- `npm run lint` → 통과.
- `npm test`(전체) → 통과. 특히:
  - `tests/prisma/workflows-view-roles.test.ts` — ROLE_ALLOW 불변식.
  - `tests/prisma/workflows-view-upgrade.test.ts`·`tests/prisma/workflows-nav-reconcile.test.ts` — 헬퍼 멱등·fail-closed.
  - `tests/kernel/access/nav-catalog.test.ts` — workflows flip(부모·자식 permission=`workflows:view`).
  - `tests/kernel/navigation/workflows-nav-visibility.test.ts` — R3 집계 게이팅(notification:view만으론 숨김, workflows:view면 노출).
- `EXTRA_PERMISSIONS`에 client create 2종; `ROLE_ALLOW`에 client view + `workflows:view` grant; 메인 seed에 WorkflowType 5종(BILLING 포함) upsert.
- seed.ts 실행 순서: `applyWorkflowsViewUpgrade`(grant) → `seedNavigation` → `applyWorkflowsNavReconcile`(flip).

## 배포 (SC-12 · 표준 restart, forward-safe)

INVENTORY.md(SSOT) 접속·경로 참조. 순서:
1. `npx prisma migrate deploy`(additive enum) → `npm run prisma:generate`(스키마 변경 필수).
2. `npm run db:seed` — WorkflowType 5종·신규 permission catalog(`workflows:view` 등)·`applyWorkflowsViewUpgrade` grant → `seedNavigation` → `applyWorkflowsNavReconcile` flip(코드 순서로 grant 먼저 보장).
3. `npm run db:seed:demo`(dev 테스트 데이터, 선택).
4. `npm run build` → `pm2 restart ops-hub`.

smoke:
- `/workflows` 캘린더 렌더, 생성 모달 유형 목록(권한별).
- `/api/workflows/calendar?start=…&end=…` 200(인증). start/end 누락 시 400.
- **notification-only role(민원 외주) 로그인 시 Workflows 메뉴 노출**(기존 설치 검증 — fresh seed만으론 불충분, R5·F1).

rollback preflight(R4·F1 ACCEPTED): 되돌리기 전 신규 kind(`WEEKLY_REPORT_CLIENT`/`MONTHLY_REPORT_CLIENT`) task 부재 확인(구버전 코드는 신규 enum에 `KIND_RESOURCE`/`TRANSITIONS` 미정의 → 상세/전이 실패). ops-hub dev=단일 pm2라 동시 version-skew 없음. 존재 시 정리/보류 후 되돌림. (multiSchema preflight 쿼리는 `workflows."WorkflowTask"` 한정 — `?schema=public` 제거 필요.)
