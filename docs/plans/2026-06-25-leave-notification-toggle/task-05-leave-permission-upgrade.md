# task-05 — leave.admin:configure 권한 업그레이드(기존 DB)

`leave.admin:configure`(D6)는 task-01이 `EXTRA_PERMISSIONS`에 등록해 Permission 행은 생기지만, **기존(비어있지 않은) DB는 `bootstrapRolePermissions`가 스킵**되어 pm이 grant를 못 받는다(R4 적대검증). 기존 `applyTeamsPermissionUpgrade`와 동형의 **멱등 upgrade-once 헬퍼**로 pm에 1회 grant한다.

## Files

- Create: `prisma/migrate-helpers/leave-notifications-upgrade.ts` — `applyLeaveNotificationsPermissionUpgrade` + 플래그·대상 상수.
- Modify: `prisma/seed.ts` — import + teams upgrade 다음에 트랜잭션 호출 1줄.
- Test: `tests/prisma/leave-notifications-upgrade.test.ts` (신규) — flag/멱등/fail-closed 검증.

## Prep

- 읽기: 엔트리포인트 §SC-1(권한 D6), spec 결정 D6, **task-01**(EXTRA_PERMISSIONS에 `["leave.admin","configure"]` 추가가 선행).
- 패턴 원본: `prisma/migrate-helpers/teams-upgrade.ts`(`applyTeamsPermissionUpgrade`) + `tests/prisma/teams-upgrade.test.ts`. 이 task는 그 구조를 leave 1키·pm 단일 대상으로 복제한다.
- **대상 역할 = `pm`만**(D6 신뢰경계): 위임 `admin`은 leave 권한 0 유지 → grant 대상 아님. OWNER는 systemRole로 자동 허용이라 RolePermission 행 불필요. fresh install은 pm `"*"`가 grant하므로 upgrade도 pm만 reconcile해 fresh/existing 패리티.

## Deps

01 (`["leave.admin","configure"]`가 `EXTRA_PERMISSIONS`에 있어야 Permission 행·`permissionIdByKey` 항목이 생긴다 — 없으면 헬퍼가 fail-closed throw).

## TDD steps

### Step 1 — 테스트 작성(실패 확인)

`tests/prisma/leave-notifications-upgrade.test.ts` 신규 작성(teams-upgrade.test.ts 미러):

```ts
import { describe, it, expect, vi } from "vitest";
import {
  applyLeaveNotificationsPermissionUpgrade,
  LEAVE_NOTIF_GRANT_KEYS,
} from "../../prisma/migrate-helpers/leave-notifications-upgrade";

type UpsertArg = { where: { roleId_permissionId_scope: { roleId: string; permissionId: string; scope: string } } };
function mkDb(flagExists: boolean) {
  return {
    systemSetting: { findUnique: vi.fn(async () => (flagExists ? { key: "x" } : null)), create: vi.fn(async () => ({})) },
    rolePermission: { upsert: vi.fn(async (_a: UpsertArg) => ({})) },
  };
}
const roleIds = new Map([["pm", "role-pm"], ["admin", "role-admin"]]);
const permIds = new Map(LEAVE_NOTIF_GRANT_KEYS.map((k, i) => [k, `perm-${i}`]));

describe("applyLeaveNotificationsPermissionUpgrade (D6/R4)", () => {
  it("플래그 없으면 pm에 leave.admin:configure grant upsert(=1) + 플래그 set(기존 비어있지 않은 DB)", async () => {
    const db = mkDb(false);
    const r = await applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(true);
    expect(db.rolePermission.upsert).toHaveBeenCalledTimes(1); // pm × 1키
    expect(db.systemSetting.create).toHaveBeenCalled();
  });

  it("D6 경계: 위임 admin 역할에는 grant하지 않는다(pm만)", async () => {
    const db = mkDb(false);
    await applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, permIds);
    const upsertedRoleIds = db.rolePermission.upsert.mock.calls.map((c) => c[0].where.roleId_permissionId_scope.roleId);
    expect(upsertedRoleIds).toContain("role-pm");
    expect(upsertedRoleIds).not.toContain("role-admin"); // 위임 user-admin 제외(신뢰경계)
  });

  it("플래그 있으면 no-op(1회 보장 — OWNER/수동 편집 보존)", async () => {
    const db = mkDb(true);
    const r = await applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, permIds);
    expect(r.applied).toBe(false);
    expect(db.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it("권한 미존재 시 throw + 플래그 미설정(fail-closed)", async () => {
    const db = mkDb(false);
    await expect(applyLeaveNotificationsPermissionUpgrade(db as never, roleIds, new Map())).rejects.toThrow(/미존재/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });

  it("pm 역할 미존재 시 throw + 플래그 미설정", async () => {
    const db = mkDb(false);
    await expect(applyLeaveNotificationsPermissionUpgrade(db as never, new Map(), permIds)).rejects.toThrow(/pm/);
    expect(db.systemSetting.create).not.toHaveBeenCalled();
  });
});
```

실행(FAIL 기대 — 헬퍼 미존재):

```bash
npx vitest run tests/prisma/leave-notifications-upgrade.test.ts
```

### Step 2 — 헬퍼 작성

`prisma/migrate-helpers/leave-notifications-upgrade.ts` 신규:

```ts
import type { UpgradeClient } from "./teams-upgrade"; // 동일한 최소 client 표면 재사용

export const LEAVE_NOTIF_UPGRADE_FLAG = "migration.leave-notifications.upgrade.applied";
export const LEAVE_NOTIF_GRANT_KEYS = ["leave.admin:configure"] as const;
// D6 신뢰경계: pm만. 위임 admin은 leave 권한 0 유지. OWNER는 systemRole 자동(행 불필요).
// fresh install은 pm:"*"로 grant하므로 upgrade도 pm만 reconcile → fresh/existing 패리티.
export const LEAVE_NOTIF_TARGET_ROLE_KEYS = ["pm"] as const;

// pm에 leave.admin:configure 멱등 grant. 이미 적용(플래그 존재)이면 no-op.
// F-K fail-closed: 대상 역할·권한 중 하나라도 없으면 throw(플래그 미설정) → 다음 seed 재시도.
// 플래그는 모든 upsert 성공 후에만 set.
export async function applyLeaveNotificationsPermissionUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: LEAVE_NOTIF_UPGRADE_FLAG } });
  if (already) return { applied: false };
  const roleIds = LEAVE_NOTIF_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`leave-notifications-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  const grants = LEAVE_NOTIF_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`leave-notifications-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
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
  await db.systemSetting.create({ data: { key: LEAVE_NOTIF_UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
```

실행(PASS 기대):

```bash
npx vitest run tests/prisma/leave-notifications-upgrade.test.ts
```

### Step 3 — seed.ts 배선

`prisma/seed.ts` 상단 import에 추가(teams-upgrade import 다음):

```ts
import { applyLeaveNotificationsPermissionUpgrade } from "./migrate-helpers/leave-notifications-upgrade";
```

`applyTeamsPermissionUpgrade` 호출(현 line 66) **다음** 줄에 추가:

```ts
  // 3c. 업그레이드-once(D6) — 기존 DB에 leave.admin:configure를 pm에 멱등 grant(bootstrap 스킵 보완, R4).
  await prisma.$transaction((tx) => applyLeaveNotificationsPermissionUpgrade(tx, roleIdByKey, permissionIdByKey));
```

### Step 4 — 검증 + 커밋

```bash
npm run typecheck
npm run lint
npm test
```

전부 통과하면 커밋:

```bash
git add prisma/migrate-helpers/leave-notifications-upgrade.ts prisma/seed.ts tests/prisma/leave-notifications-upgrade.test.ts
git commit -m "feat(seed): 기존 DB에 leave.admin:configure pm grant(upgrade-once)"
```

## Acceptance Criteria

- `npx vitest run tests/prisma/leave-notifications-upgrade.test.ts` — pm 1키 grant·admin 제외·멱등 no-op·fail-closed throw 통과.
- `npm run typecheck` / `npm run lint` / `npm test` — 전체 그린.
- 배포 검증(수동, 기존 DB): `npm run db:seed` 후 pm 사용자로 `/admin/settings`에서 leave 토글이 **보이고** 조작 시 200(403 아님). (kgs-dev smoke)

## Cautions

- **대상은 pm만.** 위임 `admin` 역할을 grant 대상에 넣지 마라 — D6 신뢰경계(user-admin이 연차 메일 제어 못 하게)를 깨뜨린다. 테스트가 `admin` 미포함을 가드한다.
- **플래그는 모든 upsert 성공 후에만 set**(fail-closed). 권한/역할 미해석 시 throw해 "applied" 오마킹을 막는다 — task-01의 `EXTRA_PERMISSIONS` 추가가 선행돼야 한다(deps 01).
- **기존 upgrade(`teams-upgrade`)를 수정하지 마라.** 별도 플래그(`migration.leave-notifications.upgrade.applied`)·별 파일로 둔다(독립 멱등성).
- 이 upgrade는 `bootstrapRolePermissions`(fresh install) 경로와 **중복돼도 안전**(upsert + 별도 플래그). fresh install은 bootstrap이 pm grant → 이 upgrade는 upsert no-op effect + 플래그만 set.
