# Task 05 — 권한 신설·시드 reconcile(D11)

`workflows.mail:configure`를 신설한다: RESOURCES·EXTRA_PERMISSIONS 추가 + 기존 DB용 upgrade-once 헬퍼(pm ALLOW) + seed 배선. 배포 preflight도 이 태스크가 명세한다.

## Files
- Modify: `src/kernel/access/catalog.ts` (RESOURCES)
- Modify: `prisma/seed-permissions.ts` (EXTRA_PERMISSIONS)
- Create: `prisma/migrate-helpers/workflows-mail-configure-upgrade.ts`
- Modify: `prisma/seed.ts` (3f-3 배선)
- Test: `tests/prisma/workflows-mail-configure-upgrade.test.ts` (신규)

## Prep
- 엔트리포인트 §SC-10.
- 참조(선례 — 패턴 그대로): `prisma/migrate-helpers/billing-create-upgrade.ts`(단순 pm grant 헬퍼), `prisma/seed.ts` 86~88행(3f-2 배선 위치).

## Deps
- 없음(다른 태스크와 병렬 가능).

## Cautions
- **Don't ROLE_ALLOW(seed-roles.ts)에 pm 항목을 추가하지 마라.** Reason: pm은 `"*"` 와일드카드 — EXTRA_PERMISSIONS에 키만 생기면 fresh seed에서 자동 확장된다.
- **Don't pm 외 역할(admin 포함)에 grant하지 마라.** Reason: D6 신뢰경계 — 위임 admin은 workflows 권한 0 유지(admin.settings:configure만으론 교집합 게이트를 못 넘는 것이 의도).
- **Don't 플래그를 upsert 실패 후에도 set하지 마라.** Reason: fail-closed — 역할·권한 미존재면 throw(플래그 미설정)로 다음 seed 재시도(선례 동일).
- **Don't 기존 upgrade 헬퍼들의 호출 순서를 재배치하지 마라.** Reason: 3f grant→5b flip 순서는 캘린더 R5·F1 산출 — 신규 배선은 3f-2 뒤 한 줄 추가만.

## TDD Steps

### 1. 헬퍼 — 실패 테스트 먼저

`tests/prisma/workflows-mail-configure-upgrade.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import {
  applyWorkflowsMailConfigureUpgrade,
  WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG,
} from "../../prisma/migrate-helpers/workflows-mail-configure-upgrade";

function fakeDb(flagExists: boolean) {
  const upserts: Array<{ create: Record<string, unknown> }> = [];
  const created: Array<Record<string, unknown>> = [];
  const db = {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        flagExists && where.key === WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG ? { key: where.key } : null,
      create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), a.data),
    },
    rolePermission: {
      findMany: async () => [],
      upsert: async (a: { create: Record<string, unknown> }) => (upserts.push(a), {}),
    },
  };
  return { db: db as never, upserts, created };
}
const roleIds = new Map([["pm", "role-pm"]]);
const permIds = new Map([["workflows.mail:configure", "perm-mail-cfg"]]);

describe("applyWorkflowsMailConfigureUpgrade (D11 upgrade-once)", () => {
  it("pm에 workflows.mail:configure ALLOW(all)를 upsert하고 플래그 기록", async () => {
    const { db, upserts, created } = fakeDb(false);
    const out = await applyWorkflowsMailConfigureUpgrade(db, roleIds, permIds);
    expect(out.applied).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create).toMatchObject({ roleId: "role-pm", permissionId: "perm-mail-cfg", effect: "ALLOW", scope: "all" });
    expect(created[0].key).toBe(WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG);
  });
  it("플래그 존재 시 no-op(멱등)", async () => {
    const { db, upserts, created } = fakeDb(true);
    const out = await applyWorkflowsMailConfigureUpgrade(db, roleIds, permIds);
    expect(out.applied).toBe(false);
    expect(upserts).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
  it("pm 역할 미존재 → throw(fail-closed, 플래그 미설정 — 다음 seed 재시도)", async () => {
    const { db, created } = fakeDb(false);
    await expect(applyWorkflowsMailConfigureUpgrade(db, new Map(), permIds)).rejects.toThrow(/pm/);
    expect(created).toHaveLength(0);
  });
  it("권한 미존재 → throw(fail-closed)", async () => {
    const { db, created } = fakeDb(false);
    await expect(applyWorkflowsMailConfigureUpgrade(db, roleIds, new Map())).rejects.toThrow(/workflows\.mail:configure/);
    expect(created).toHaveLength(0);
  });
});
```

실행: `npm test -- tests/prisma/workflows-mail-configure-upgrade.test.ts` → **FAIL**(모듈 없음).

### 2. 헬퍼 구현

`prisma/migrate-helpers/workflows-mail-configure-upgrade.ts` 생성:

```ts
import type { UpgradeClient } from "./teams-upgrade"; // 동일한 최소 client 표면 재사용

// 메일 수신자 관리 신설 권한 workflows.mail:configure(D11). fresh install은 pm:"*"로 보유하지만
// bootstrapRolePermissions는 RolePermission이 하나라도 있으면 스킵되므로 기존 DB(dev/cutover 대상)의 pm에는
// 부여되지 않는다. billing-create-upgrade 선례와 동일하게 별도 멱등 플래그로 1회 reconcile한다.
export const WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG = "migration.workflows-mail-configure.upgrade.applied";
export const MAIL_CONFIGURE_GRANT_KEYS = ["workflows.mail:configure"] as const;
// D6 신뢰경계: pm만(OWNER는 systemRole 자동). 위임 admin은 workflows 권한 0 유지 —
// admin.settings:configure만으로는 교집합 게이트를 넘지 못한다(의도).
export const MAIL_CONFIGURE_TARGET_ROLE_KEYS = ["pm"] as const;

// pm에 workflows.mail:configure 멱등 grant. 이미 적용(플래그 존재)이면 no-op.
// fail-closed: 대상 역할·권한 중 하나라도 없으면 throw(플래그 미설정) → 다음 seed 재시도. 플래그는 모든 upsert 성공 후에만 set.
export async function applyWorkflowsMailConfigureUpgrade(
  db: UpgradeClient,
  roleIdByKey: Map<string, string>,
  permissionIdByKey: Map<string, string>,
): Promise<{ applied: boolean }> {
  const already = await db.systemSetting.findUnique({ where: { key: WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG } });
  if (already) return { applied: false };
  const roleIds = MAIL_CONFIGURE_TARGET_ROLE_KEYS.map((key) => {
    const id = roleIdByKey.get(key);
    if (!id) throw new Error(`workflows-mail-configure-upgrade: '${key}' 역할 미존재(seed 순서/드리프트) — 플래그 미설정, 재시도`);
    return id;
  });
  const grants = MAIL_CONFIGURE_GRANT_KEYS.map((key) => {
    const pid = permissionIdByKey.get(key);
    if (!pid) throw new Error(`workflows-mail-configure-upgrade: 권한 '${key}' 미존재 — 플래그 미설정, 재시도`);
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
  await db.systemSetting.create({ data: { key: WORKFLOWS_MAIL_CONFIGURE_UPGRADE_FLAG, value: { appliedAt: "bootstrap" } } });
  return { applied: true };
}
```

실행: `npm test -- tests/prisma/workflows-mail-configure-upgrade.test.ts` → **PASS**.

### 3. RESOURCES·EXTRA_PERMISSIONS·seed 배선

`src/kernel/access/catalog.ts`의 RESOURCES에서 workflows 줄을 교체:

```ts
  "workflows", "workflows.weekly", "workflows.billing", "workflows.notification",
  "workflows.weeklyClient", "workflows.monthlyClient", "workflows.mail",
```

(`workflows.mail:view`도 자동 생성된다 — 소비처는 없고 권한 매트릭스 노출용. 무해.)

`prisma/seed-permissions.ts`의 workflows 블록에 추가(`["workflows.weeklyClient", "create"], ["workflows.monthlyClient", "create"],` 줄 다음):

```ts
  ["workflows.mail", "configure"],
```

`prisma/seed.ts`: import 블록에 추가(13행 `applyWorkflowsClientKindsUpgrade` import 다음):

```ts
import { applyWorkflowsMailConfigureUpgrade } from "./migrate-helpers/workflows-mail-configure-upgrade";
```

3f-2 호출(88행) 바로 다음에 배선:

```ts
  // 3f-3. 업그레이드-once(D11) — 기존 DB의 pm에 신설 workflows.mail:configure를 멱등 grant(bootstrap 스킵 보완).
  await prisma.$transaction((tx) => applyWorkflowsMailConfigureUpgrade(tx, roleIdByKey, permissionIdByKey));
```

### 4. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/prisma tests/kernel
```

(참고: `seed-permissions.test.ts`의 "카탈로그 permission ⊆ seed 집합" 검사는 task-09가 catalog에 `workflows.mail:configure` 항목을 추가한 뒤에도 이 태스크의 seed 추가 덕에 통과한다 — 이 태스크가 task-09보다 먼저여야 하는 이유.)

전부 green이면 위 Files만 stage해 커밋.

## 배포 (이 feature 전체의 런북 — 머지 후 kgs-dev)

표준 restart(D13). 순서:

1. **preflight**(SSH, `psql`은 `?schema=public` 제거 + multiSchema라 스키마 한정 필수):
   ```sql
   -- ① D5 전제 증명: 둘 다 0이어야 함. non-null이면 배포 중단(fail-fast) — 값을 D3 구조로 이관하거나 폐기 판단.
   SELECT count(*) FROM workflows."WorkflowTask" WHERE "recipients" IS NOT NULL;
   SELECT count(*) FROM workflows."WorkflowType" WHERE "defaultRecipients" IS NOT NULL;
   -- ② 死설정 잔존값 확인(§4.6): 행이 있고 값이 비어있지 않으면 새 세트로 수동 이관 판단.
   SELECT value FROM kernel."SystemSetting" WHERE key = 'workflows.weeklyReport.defaultRecipients';
   ```
2. `git pull` → `npm ci` → `npm run prisma:generate`(npm ci는 client 재생성 안 함) → `npx prisma migrate deploy`(additive 2건) → `npm run db:seed`(신설 권한 catalog + 3f-3 pm reconcile) → `npm run build` → `pm2 restart ops-hub`.
3. **DB 검증**: `Permission`에 `workflows.mail/configure` 행, pm `RolePermission` ALLOW/all, `SystemSetting`에 `migration.workflows-mail-configure.upgrade.applied` 플래그.
4. smoke: `/login` 200 + 인증 필요 라우트(`/api/workflows/mail/contacts` 비인증 401) + P2010 없음(stale build 교훈 — 인증·advisory 경로 확인).

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과.
- `npm test -- tests/prisma/workflows-mail-configure-upgrade.test.ts` → 통과(4케이스).
- `npm test -- tests/kernel` → 통과(RESOURCES 추가로 깨지는 기존 테스트 없음 확인).
- `prisma/seed.ts`에 3f-3 배선이 3f-2 직후·3e(WorkflowType upsert) 앞에 위치.
- pm 외 역할 grant 없음(헬퍼 상수로 고정).
