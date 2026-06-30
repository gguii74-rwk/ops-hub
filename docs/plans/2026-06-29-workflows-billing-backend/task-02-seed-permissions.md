# Task 02 — WorkflowType(BILLING) 시드 + 권한/역할 grant

**Purpose:** `workflows.billing:generate` Permission 누락을 메우고, `WorkflowType(BILLING)`을 kind 기준 upsert로 정규화하며(J3), 기존(비어있지 않은) DB에 billing 4권한을 pm에 멱등 grant하는 upgrade helper를 추가한다(H3·D4·spec §5).

## Files

- **Modify:** `prisma/seed-permissions.ts` — `EXTRA_PERMISSIONS`에 `["workflows.billing", "generate"]` 추가
- **Create:** `prisma/migrate-helpers/billing-upgrade.ts` — pm grant 멱등 upgrade-once
- **Modify:** `prisma/seed.ts` — upgrade 호출(3d) + `WorkflowType(BILLING)` kind 기준 upsert(3e)
- **Create (test):** `tests/prisma/billing-upgrade.test.ts`

## Prep

- 읽기: spec §5(전체), entrypoint §Shared Contracts SC-9.
- 참조 패턴: `prisma/migrate-helpers/leave-notifications-upgrade.ts`(동형), `tests/prisma/leave-notifications-upgrade.test.ts`(테스트 미러), `prisma/migrate-helpers/teams-upgrade.ts`의 `UpgradeClient` 타입(재사용).
- 사실: `catalog.ts`에 `workflows.billing` resource·`generate` action은 이미 존재. `EXTRA_PERMISSIONS`에 `generate`만 빠져 Permission row가 안 생긴다. pm은 `ROLE_ALLOW`에서 `["*"]`라 **fresh seed**에서는 4권한 모두 받지만, **기존 DB**는 `bootstrapRolePermissions`가 `count>0`으로 스킵 → pm이 신규 `billing:generate`를 못 받는다(H3) → upgrade 필요.

## Deps

없음.

## TDD steps

### 1. 실패 테스트 작성 — `tests/prisma/billing-upgrade.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { applyBillingPermissionUpgrade, BILLING_GRANT_KEYS } from "../../prisma/migrate-helpers/billing-upgrade";

type UpsertArg = { where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } } };
function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: { upsert: vi.fn(async (_a: UpsertArg) => ({})) },
  };
}
const roleIds = new Map([["pm", "role-pm"], ["admin", "role-admin"]]);
const permIds = new Map(BILLING_GRANT_KEYS.map((k, i) => [k, `perm-${i}`]));

describe("applyBillingPermissionUpgrade (H3)", () => {
  it("플래그 없으면 pm에 billing 4권한 grant(=4) + 플래그 set", async () => {
    const db = mkDb(false);
    const r = await applyBillingPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(4);
    expect(db.systemSetting.create).toHaveBeenCalled();
  });
  it("pm만 grant(위임 admin 제외 — 신뢰경계)", async () => {
    const db = mkDb(false);
    await applyBillingPermissionUpgrade(db as never, roleIds, permIds);
    const ids = db.rolePermission.upsert.mock.calls.map((c) => c[0].where.roleId_permissionId_scope.roleId);
    expect(ids).toContain("role-pm");
    expect(ids).not.toContain("role-admin");
  });
  it("플래그 있으면 no-op(1회 보장)", async () => {
    const db = mkDb(true);
    const r = await applyBillingPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });
  it("권한 미존재 → throw + 플래그 미설정(fail-closed)", async () => {
    const db = mkDb(false);
    await expect(applyBillingPermissionUpgrade(db as never, roleIds, new Map())).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
  it("pm 역할 미존재 → throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyBillingPermissionUpgrade(db as never, new Map(), permIds)).rejects.toThrow(/pm/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- tests/prisma/billing-upgrade.test.ts
```
모듈 미존재 = 예상 FAIL.

### 3. 구현 — `prisma/migrate-helpers/billing-upgrade.ts`

```ts
import type { UpgradeClient } from "./teams-upgrade"; // 동일한 최소 client 표면 재사용

export const BILLING_UPGRADE_FLAG = "migration.billing.upgrade.applied";
export const BILLING_GRANT_KEYS = [
  "workflows.billing:configure",
  "workflows.billing:generate",
  "workflows.billing:send",
  "workflows.billing:view",
] as const;
// H3/D1 신뢰경계: pm만. 위임 admin은 workflows 권한 0 유지. OWNER는 systemRole 자동(행 불필요).
// fresh install은 pm:"*"로 grant하므로 upgrade도 pm만 reconcile → fresh/existing 패리티.
export const BILLING_TARGET_ROLE_KEYS = ["pm"] as const;

// pm에 billing 4권한 멱등 grant. 이미 적용(플래그 존재)이면 no-op.
// F-K fail-closed: 대상 역할·권한 중 하나라도 없으면 throw(플래그 미설정) → 다음 seed 재시도.
// 플래그는 모든 upsert 성공 후에만 set.
export async function applyBillingPermissionUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: BILLING_UPGRADE_FLAG } });
  if (already) return { applied: false };
  const roleIds = BILLING_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`billing-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  const grants = BILLING_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`billing-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
    return pid;
  });
  for (const roleId of roleIds) {
    for (const pid of grants) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId_scope: { roleId, permissionId: pid, scope: "all" } },
        update: {},
        create: { roleId, permissionId: pid, effect: "ALLOW", scope: "all" },
      });
    }
  }
  await db.systemSetting.create({ data: { key: BILLING_UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
```

### 4. `EXTRA_PERMISSIONS` 보강 — `prisma/seed-permissions.ts`

다음 줄을

```ts
  ["workflows.billing", "create"], ["workflows.billing", "send"],
  ["workflows.billing", "configure"],
```

이렇게 바꾼다(generate 추가):

```ts
  ["workflows.billing", "create"], ["workflows.billing", "generate"], ["workflows.billing", "send"],
  ["workflows.billing", "configure"],
```

### 5. seed.ts 배선 — `prisma/seed.ts`

(a) import 추가(다른 upgrade import 옆):

```ts
import { applyBillingPermissionUpgrade } from "./migrate-helpers/billing-upgrade";
```

(b) `3c`(leave-notifications upgrade) **다음에** 추가:

```ts
  // 3d. 업그레이드-once(H3) — 기존 DB에 billing 4권한을 pm에 멱등 grant(bootstrap 스킵 보완).
  await prisma.$transaction((tx) => applyBillingPermissionUpgrade(tx, roleIdByKey, permissionIdByKey));

  // 3e. WorkflowType(BILLING) — kind 기준 upsert(J3). seed-demo가 id="wf-billing"으로 만든 행과 kind 충돌 없이
  //     templatePath/name/recurrence를 신규 저장소 규약(Template/대금청구)으로 정규화한다.
  await prisma.workflowType.upsert({
    where: { kind: "BILLING" },
    update: { name: "대금청구", templatePath: "Template/대금청구", recurrence: "monthly" },
    create: {
      id: "billing", kind: "BILLING", name: "대금청구", templatePath: "Template/대금청구",
      recurrence: "monthly", isActive: true,
    },
  });
```

(`defaultRecipients`는 create에서 생략 = null. 수신자는 send 입력 우선, spec §9.2.)

### 6. 실행 → PASS

```bash
npm test -- tests/prisma/billing-upgrade.test.ts
```

### 7. commit

```bash
git add prisma/seed-permissions.ts prisma/migrate-helpers/billing-upgrade.ts prisma/seed.ts tests/prisma/billing-upgrade.test.ts
git commit -m "feat(workflows): billing:generate 권한 + WorkflowType(BILLING) 시드 + pm grant upgrade(H3)"
```

## Acceptance Criteria

- `npm test -- tests/prisma/billing-upgrade.test.ts` 전건 PASS(멱등성·pm-only·fail-closed).
- `npm run typecheck` / `npm run lint` / `npm test`(전체) 통과.
- (배포 시 수동 검증, plan 범위 밖) `npm run db:seed`가 기존 DB에서 충돌 없이 통과하고 pm이 billing 4권한을 받는다.

## Cautions

- **Don't** `WorkflowType`을 `id` 기준 create로 만들지 말 것. Reason: `kind`가 `@unique`이고 seed-demo가 `id="wf-billing"`으로 이미 BILLING을 만들었다 — id create는 kind 충돌(P2002). kind 기준 upsert만(J3).
- **Don't** upgrade helper를 위임 admin 역할에도 grant하지 말 것. Reason: workflows는 pm/OWNER 신뢰경계(H3·D1). admin은 사용자관리 위임만.
- **Don't** 플래그를 upsert 전에 set하지 말 것. Reason: 부분 적용 후 영구 "applied"로 fail-open된다. 모든 grant 성공 후에만 플래그.
