# task-04 — 사용자관리 department→teamId 이행 + signup 필드 제거

**목적:** 사용자 관리 도메인의 모든 `department` reader/writer를 `teamId`(FK)로 전환하고, signup 자가가입의 **부서 입력 필드를 완전히 제거**(사용자 결정 — Team은 관리자 승인 시 배정). teamId 변경/비활성화 시 `reconcileTeamLeadTx`로 팀장 불변식 유지.

## Files
- Modify: `src/modules/admin/users/validations/index.ts` (`department`→`teamId`)
- Modify: `src/modules/admin/users/validations/signup.ts` (`department` 제거)
- Modify: `src/modules/admin/users/services/index.ts` (department→teamId pass-through + F-N: scope 전달 + F-Q: override 생성/삭제를 actor 잠금 트랜잭션으로 감싸 in-tx 재해석)
- Modify: `src/modules/admin/users/services/guards.ts` (F-N: `assertOverrideWithinActorGrant`를 scope-aware로 — any-scope summary escalation 차단 + F-Q: optional `tx` 주입)
- Modify: `src/modules/admin/users/repositories/index.ts` (select/create/update teamId + team.name + reconcile wiring + F-Q: `createOverride`/`deleteOverride` optional `tx`)
- Modify: `src/app/api/auth/signup/route.ts` (department 미저장)
- Modify: `src/app/signup/_components/signup-form.tsx` (부서 Input 제거)
- Modify: `src/app/(app)/admin/users/_components/users-list.tsx` (teamName 표시)
- Modify: `src/app/(app)/admin/users/_components/approve-modal.tsx` (team picker)
- Modify: `src/app/(app)/admin/users/new/_components/create-user-form.tsx` (team picker)
- Modify: `src/app/(app)/admin/users/[id]/_components/user-edit.tsx` (team picker)
- Add: `src/modules/admin/teams/repositories/index.ts` — `listActiveTeamOptions()` (picker용)
- Modify (tests): `tests/modules/admin/users/{validations,users-service,signup-validation,repositories,approve-schema,anti-escalation-integration}.test.ts`, `tests/app/{auth-signup-route,admin/users/payload}.test.ts`, `tests/app/api/auth/signup-abuse.test.ts`, `tests/app/api/admin/users/{route,gate-enumeration}.test.ts`

## Prep
- 엔트리포인트 §Shared Contracts "스키마 추가"(teamId 공존), "팀장 불변식"(reconcile).
- task-03 산출: teams repo/service, `reconcileTeamLeadTx`. task-01: teamId/team 관계.
- 기존 코드: `repositories/index.ts`의 `listUsers`/`getUserDetail`/`createActiveUserByAdminTx`/`approveTx`/`updateUserTx`, `services/index.ts`의 approve/create/update.

## Deps
01 (teamId), 02 (getEffectiveScope — F-N override scope 가드), 03 (teams 모듈·reconcile·picker 옵션).

## Steps

### 1. teams 옵션 provider 추가

`src/modules/admin/teams/repositories/index.ts`에 추가:
```ts
export function listActiveTeamOptions(): Promise<Array<{ id: string; name: string }>> {
  return prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
```
`src/modules/admin/teams/services/index.ts`에 re-export:
```ts
export { listActiveTeamOptions } from "../repositories";
```

### 2. validations — department→teamId (실패 테스트 먼저)

`tests/modules/admin/users/validations.test.ts`에서 `department` 단언을 `teamId`로 바꾼 케이스를 추가/치환(아래 코드 반영), 실행 → **FAIL**.

`src/modules/admin/users/validations/index.ts`:
- 줄 16 `const department = ...` → 교체:
  ```ts
  const teamId = z.string().min(1).nullish(); // 팀 배정(관리자 확정). null=무소속, undefined=미변경
  ```
- `adminCreateSchema`의 `employmentType, jobFunction, department,` → `employmentType, jobFunction, teamId,`
- `approveSchema`의 `department: department,` → `teamId: teamId,`
- `updateUserSchema`의 `department,` → `teamId,`
- 타입 alias는 자동 반영(`UpdateUserInput` 등).

### 3. signup validation — department 제거

`src/modules/admin/users/validations/signup.ts` 줄 12의 `department: z.string()....` **삭제**(필드 제거). signup은 부서/팀을 받지 않는다.

### 4. signup route — department 미저장

`src/app/api/auth/signup/route.ts` 줄 45: `jobFunction: input.jobFunction, department: input.department, tokenHash, ...` → `department: input.department,` **제거**:
```ts
        jobFunction: input.jobFunction, tokenHash, tokenExpiresAt,
```
그리고 `createPendingSignup` 호출 인자에서 department를 빼야 하므로 step 6에서 `createPendingSignup` 시그니처도 department 제거.

### 5. signup form — 부서 Input 제거

`src/app/signup/_components/signup-form.tsx`:
- 줄 26 `const [department, setDepartment] = useState("");` **삭제**
- 줄 48 body의 `department: department || null,` **삭제**
- 줄 75 부서 `<Input id="s-dept" .../>` 와 그 label 블록 **삭제**

### 6. repositories — teamId + team.name + reconcile

`src/modules/admin/users/repositories/index.ts`:

**(a0) active-team 검증 helper(F-J — 임의/비active teamId 차단).** validation은 teamId를 non-empty string으로만 보므로, **teamId를 non-null로 쓰기 전** 같은 트랜잭션에서 그 팀이 **존재 + active**인지 확인한다. 미존재/비active면 도메인 에러(→ `mapError`가 400). 비active 팀이 승인/캘린더/알림의 authz 경계가 되는 것·잘못된 id의 FK 500을 막는다.
```ts
import { UserValidationError } from "../errors";
// teamId가 null이면 무소속(검증 불필요). 값이 있으면 active 팀이어야 한다. tx 내부 호출(쓰기와 같은 트랜잭션).
async function assertActiveTeamTx(tx: Prisma.TransactionClient, teamId: string | null | undefined): Promise<void> {
  if (teamId == null) return;
  const team = await tx.team.findUnique({ where: { id: teamId }, select: { active: true } });
  if (!team || !team.active) throw new UserValidationError("배정할 팀이 없거나 비활성 상태입니다.");
}
```
이 helper를 **(e) create·(f) approve·(g) update**에서 teamId를 data에 넣기 직전 호출한다(teamId가 patch/인자에 **존재하고 non-null**일 때만). null(무소속)은 통과.

**(a) 타입/DTO**: `department: string | null`이 들어간 인터페이스(`UserRow`/`UserDetail`/생성·승인·편집 인자)를 모두 `teamId: string | null`로 교체하고, 표시용 DTO에는 `teamName: string | null`을 추가.
- `UserRow`(줄 13 부근): `department: string | null;` → `teamId: string | null; teamName: string | null;`

**(b) listUsers**(줄 51-65): select `department: true` → `teamId: true, team: { select: { name: true } }`. 매핑 `department: u.department` → `teamId: u.teamId, teamName: u.team?.name ?? null`.

**(c) getUserDetail**(줄 73-95): 동일하게 select `department: true` → `teamId: true, team: { select: { name: true } }`, 매핑 `department: u.department` → `teamId: u.teamId, teamName: u.team?.name ?? null`. `UserDetail` 인터페이스도 `teamId`/`teamName`.

**(d) createPendingSignup**(줄 112-): 인자 `department: string | null` **제거**, data의 `department: args.department,` **제거**(signup은 팀 미배정 — PENDING은 무소속, 승인 시 배정).

**(e) createActiveUserByAdminTx**(줄 113·135 부근): 인자 `department: string | null` → `teamId: string | null`, create data `department: args.department,` → `teamId: args.teamId,`. **create 전 `await assertActiveTeamTx(tx, args.teamId);`**(F-J).

**(f) approveTx**(줄 193·203·225·246 부근): 인자 타입의 `department: string | null` → `teamId: string | null`; decision 타입 `department?: string | null` → `teamId?: string | null`; create/update data의 `department: ...` → `teamId: ...`. **순서**: ① user create/update **data 쓰기 직전** `if (decision.teamId !== undefined) await assertActiveTeamTx(tx, decision.teamId);`(F-J — FK 500 전에 도메인 400), ② **쓰기 후** teamId가 바뀌면 reconcile:
```ts
// 쓰기 후: teamId가 지정되면 reconcile(이 user가 어떤 팀의 stale lead였으면 정리). active 검증은 위에서 이미 통과.
if (decision.teamId !== undefined) {
  const { reconcileTeamLeadTx } = await import("@/modules/admin/teams/repositories");
  await reconcileTeamLeadTx(tx, id);
}
```

**(g) updateUserTx**(줄 279·291 부근): patch 타입 `department?: string | null` → `teamId?: string | null`; update data `department: patch.department` → `teamId: patch.teamId`. **순서**: ① update **data 쓰기 직전** `if (patch.teamId !== undefined) await assertActiveTeamTx(tx, patch.teamId);`(F-J), ② **쓰기 후** 같은 트랜잭션에서 reconcile(팀 이동으로 무효가 된 lead 정리, D1):
```ts
// 쓰기 후: teamId가 바뀌면, 이 user가 떠난 팀의 팀장이었다면 그 팀의 leadUserId를 정리(F3/D1 불변식).
if (patch.teamId !== undefined) {
  const { reconcileTeamLeadTx } = await import("@/modules/admin/teams/repositories");
  await reconcileTeamLeadTx(tx, id);
}
```
(동적 import는 admin/users→admin/teams 순환 경계 회피용. 정적 import도 boundaries 허용이면 그쪽 선호 — lint 확인.)

> **user 비활성화 reconcile:** 기존 비활성화(disable) 경로(상태 DISABLED 전이)에도 `reconcileTeamLeadTx(tx, id)`를 추가한다. 해당 함수 위치는 `repositories/index.ts`의 disable/status 전이 tx — 변경 트랜잭션 안에서 호출. (없으면 §9 "비활성화로 무효가 된 lead 정리" 미충족.)

### 7. services — pass-through 치환

`src/modules/admin/users/services/index.ts`:
- `approveUser`(줄 93): `...(input.department !== undefined ? { department: input.department ?? null } : {}),` → `...(input.teamId !== undefined ? { teamId: input.teamId ?? null } : {}),`
- `createUserByAdmin`(줄 119): `department: input.department ?? null,` → `teamId: input.teamId ?? null,`
- `updateUser`(줄 134): `...(patch.department !== undefined ? { department: patch.department ?? null } : {}),` → `...(patch.teamId !== undefined ? { teamId: patch.teamId ?? null } : {}),`

### 7b. override 부여 scope-aware + 쓰기 트랜잭션 내부 권위 (F-N escalation 차단 · F-Q in-tx authz)

`getPermissionSummary`가 any-scope가 되면(task-02) `ActorContext.permissionKeys`도 any-scope다. 증분 ①의 `assertOverrideWithinActorGrant`(guards.ts)는 비-critical ALLOW override를 **키 존재만**으로 허용한다 — `leave.approval`은 non-critical·scopeable이라, **team-scope `leave.approval:approve`만 가진 위임 admin이 타인에게 all-scope override를 부여**해 팀을 넘어 escalation할 수 있다(F-N). → 가드를 **scope-aware**로: 부여하려는 override scope가 actor의 **effective scope**를 넘으면 거부.

`src/modules/admin/users/services/guards.ts` — 시그니처에 scope 추가 + async + `getEffectiveScope` 사용 + **optional `tx` 주입(F-Q)**:
```ts
import { getEffectiveScope, SCOPE_RANK, type EnforceableScope } from "@/kernel/access";
import type { Scope } from "@/kernel/access/decision";
import type { Prisma } from "@prisma/client";

export async function assertOverrideWithinActorGrant(
  actor: ActorContext, resource: string, action: string, effect: "ALLOW" | "DENY", scope: Scope,
  tx?: Prisma.TransactionClient, // F-Q: 쓰기 트랜잭션 내부 호출 시 tx 클라이언트로 현재 권한 재해석
): Promise<void> {
  if (actor.isOwner) return;
  const key = permissionKey(resource, action);
  if (isCriticalKey(key)) throw new EscalationError(`critical 권한(${key})에 대한 override(${effect})는 OWNER만 가능합니다.`);
  if (effect === "ALLOW") {
    // 키 존재(any-scope)만으론 부족(F-N). actor의 실제 effective scope를 구해, 부여 scope가 그보다 넓으면 거부.
    const actorScope = await getEffectiveScope(actor.userId, resource, action, tx); // null=미보유. tx면 in-tx 재해석(F-Q)
    if (actorScope == null) throw new EscalationError(`보유하지 않은 권한(${key})은 ALLOW로 부여할 수 없습니다.`);
    if (scope === "assigned" || SCOPE_RANK[scope as EnforceableScope] > SCOPE_RANK[actorScope]) {
      throw new EscalationError(`보유 scope(${actorScope})를 넘는 ${scope} 권한은 부여할 수 없습니다.`); // team-actor가 all override 불가
    }
  }
  // 비-critical DENY는 허용(제한적 — escalation 아님).
}
```
(`actor.permissionKeys.has(key)` 키 검사는 `getEffectiveScope==null`로 대체·포섭 — getEffectiveScope가 보유+clamp를 한 번에. `permissionKeys`는 다른 가드에서 계속 쓰면 유지.)

`src/modules/admin/users/services/index.ts` — 두 호출부를 **단일 트랜잭션으로 감싸 actor 잠금 후 in-tx 재해석**(F-Q). guard는 service 레이어 유지(repo→service boundary 위반 회피), `createOverride`/`deleteOverride`에 tx 주입:
```ts
// upsertOverride(생성) — 기존 createOverride 직접 호출을 tx로 감쌈:
return prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${actor.userId} FOR UPDATE`; // actor 직렬화
  await assertOverrideWithinActorGrant(actor, dto.resource, dto.action, dto.effect, dto.scope, tx); // in-tx 재해석
  return createOverride(id, input, actor.userId, tx); // 같은 tx에 쓰기 — precheck↔write TOCTOU 제거
});
// removeOverride(제거/반전):
await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT 1 FROM "kernel"."User" WHERE "id" = ${actor.userId} FOR UPDATE`;
  await assertOverrideWithinActorGrant(actor, ov.resource, ov.action, ov.effect === "DENY" ? "ALLOW" : "DENY", ov.scope, tx);
  await deleteOverride(id, overrideId, actor.userId, tx); // (DENY 제거=ALLOW 부여 동형 — scope 검사 일관)
});
```
`createOverride`/`deleteOverride`(repositories)는 **optional `tx?: Prisma.TransactionClient`**를 받아, 주입 시 자체 `prisma.$transaction`을 열지 않고 그 tx에 합류한다(이 파일 line 302 `else await prisma.$transaction(run)` idiom과 동일 — run 본문을 분리해 tx 유무로 분기). actor 잠금+guard와 같은 트랜잭션이라, precheck 이후 actor revoke/disable/deny가 끼면 in-tx `getEffectiveScope(tx)`가 잡아 **부여/제거가 롤백**된다(승인 task-05·매트릭스 task-06과 동일한 in-tx authz 표준). 기존 가용성 체크(DENY lockout·ALLOW 제거 권한 하락)는 같은 tx 안에서 그대로 유지.

**F-N negative 테스트**(`tests/modules/admin/users/` — override 가드): team-scope `leave.approval:approve`만 가진 위임 admin(getEffectiveScope→"team" mock) →
- all-scope `leave.approval:approve` ALLOW override 생성 → **EscalationError**(보유 scope 초과).
- team-scope override 생성 → 허용(rank 동일).
- OWNER → 무제한 허용. 비보유 권한 ALLOW → EscalationError.

**F-Q in-tx 원자성 테스트**(override authz가 쓰기 tx 안): actor가 precheck 시점엔 scope 보유하나 write 직전 revoke/disable되는 시나리오를 mock으로 — `assertOverrideWithinActorGrant`에 주입된 `tx`의 `getEffectiveScope(tx)`가 null/축소 scope를 반환하면 `upsertOverride`/`removeOverride`가 **EscalationError로 롤백**(override 미생성/미삭제, audit 미기록). 또한 `createOverride`/`deleteOverride`가 주입 tx에 합류(별도 `prisma.$transaction` 미개시)하는지, actor 행 `FOR UPDATE`가 guard보다 먼저 실행되는지 단언.

### 8. admin UI — team picker / 표시

각 폼은 자유텍스트 `<Input department>`를 **active 팀 select**로 바꾼다. page(server)가 `listActiveTeamOptions()`를 불러 client에 `teams` prop으로 전달한다(각 page.tsx에 추가).

**users-list.tsx**(줄 21·표시): `department: string | null` → `teamId: string | null; teamName: string | null`; 표시 셀 `{u.department ?? "-"}` → `{u.teamName ?? "-"}`.

**approve-modal.tsx**(줄 15·21·35·79): `Target`의 `department` → `teamId/teamName`; state `const [teamId, setTeamId] = useState(target.teamId ?? "")`; body `name, teamId: teamId || null, ...`; `<Input ap-dept>` → `<select>` (props로 받은 `teams` 매핑, 빈 옵션=무소속).

**create-user-form.tsx**(줄 16·23·33·44·72): payload 타입 `department: string` → `teamId: string | null`; state `teamId`; body `teamId: teamId || null`; `<Input dept>` → team `<select>`.

**user-edit.tsx**(줄 19·39·48·66·127·146): `department` → `teamId/teamName`; state `teamId`; init `setTeamId(data.teamId ?? "")`; body `teamId: teamId || null`; 편집 `<Input edit-dept>` → team `<select>`; 표시 `부서: {data.department}` → `팀: {data.teamName ?? "-"}`.

각 page.tsx(`admin/users/page.tsx`, `admin/users/new/page.tsx`, `admin/users/[id]/page.tsx`)에 `const teams = await listActiveTeamOptions();` 추가 후 컴포넌트에 전달.

### 9. 테스트 전수 전환

`tests/`의 user-domain department 참조 11개 파일을 **teamId로 치환 또는 department 케이스 제거**한다(F8 게이트가 0건을 강제 — task-07). 변환 규칙:
- 입력 페이로드 `department: "X"` → `teamId: "<team-id>"` (또는 무소속 케이스 `teamId: null`).
- DTO 단언 `department` → `teamName`/`teamId`.
- signup 관련 테스트(`signup-validation`, `auth-signup-route`, `signup-abuse`): department 필드 자체를 **제거**(더 이상 받지 않음). signup이 department를 거부하지 않고 **무시**하는지(추가 필드 strip) 또는 schema가 strict라 거부하는지 확인 — 기존 schema가 passthrough면 무시, strict면 테스트에서 필드 삭제.

대표 예 — `tests/modules/admin/users/validations.test.ts`:
```ts
// before: expect(adminCreateSchema.parse({ ...base, department: "개발1팀" }).department).toBe("개발1팀");
// after:
expect(adminCreateSchema.parse({ ...base, teamId: "team-1" }).teamId).toBe("team-1");
expect(adminCreateSchema.parse({ ...base, teamId: null }).teamId).toBeNull();
```
나머지 10개 파일도 같은 규칙으로 기계 치환. 실행하며 RED→GREEN.

**F-J 검증 negative(필수 — repositories 테스트)**: create/approve/update에 **미존재 teamId** → `UserValidationError`(→ route 400); **비active 팀 id** → `UserValidationError`; **null teamId** → 통과(무소속). `assertActiveTeamTx`가 data 쓰기 전에 호출됨(`tx.team.findUnique` mock으로 active/inactive/none 분기). 대표:
```ts
it("비active 팀 배정은 거부(F-J)", async () => {
  h.tx.team.findUnique.mockResolvedValue({ active: false });
  await expect(updateUserTx("u1", { teamId: "team-x" }, ...)).rejects.toBeInstanceOf(UserValidationError);
  expect(h.tx.user.update).not.toHaveBeenCalled();
});
it("미존재 팀 배정은 거부(FK 500 전에 400)", async () => {
  h.tx.team.findUnique.mockResolvedValue(null);
  await expect(updateUserTx("u1", { teamId: "team-x" }, ...)).rejects.toBeInstanceOf(UserValidationError);
});
```

### 10. 통과 + 커밋
`npm test -- admin/users` 통과. `rg -n "\bdepartment\b" src/modules/admin src/app/api/auth/signup src/app/signup src/app/\(app\)/admin/users` → **0건**(이 task 범위 확인; 전역 0은 task-07).

## Acceptance Criteria
- `npm run typecheck` → 0 errors (teamId/team 관계 존재 — task-01).
- `npm test -- admin/users auth-signup` → PASS.
- `npm run lint` → 0 errors (admin/users→admin/teams 경계 허용 확인; 불가 시 동적 import).
- 범위 내 `department` 참조 0(전역 게이트는 task-07).
- **F-J**: create/approve/update가 미존재·비active teamId를 `UserValidationError`(400)로 거부, null은 통과 — 테스트 GREEN.
- **F-N**: team-scope `leave.approval:approve`만 가진 위임 admin이 all-scope override를 부여하면 `EscalationError`; team-scope override는 허용 — 테스트 GREEN(any-scope summary escalation 차단).
- **F-Q**: override 생성/삭제가 actor 행 `FOR UPDATE` + in-tx `getEffectiveScope(tx)` 재해석 트랜잭션 안에서 수행 — precheck 이후 revoke/disable/deny 시 부여/제거 롤백 — 테스트 GREEN.
- 수동: signup 폼에 부서 입력 없음; 승인 모달·생성·편집에 팀 select; 사용자 목록에 팀 이름 표시; 직접 API로 가짜 teamId → 400(FK 500 아님).

## Cautions
- **Don't** signup이 팀을 받게 한다. Reason: Team은 curated(관리자 승인 시 배정) — 자유텍스트 희망부서는 제거(사용자 결정). PENDING은 무소속, 승인 시 teamId 배정.
- **Don't** teamId 변경/비활성화에서 reconcile을 빠뜨리거나 teamId UPDATE와 **다른** 트랜잭션에 둔다. Reason: 팀을 떠난 사용자가 이전 팀 leadUserId로 남으면 알림이 교차팀으로 샌다(F3/D1). 또한 teamId UPDATE+reconcile이 같은 tx여야 task-03 팀장 지정의 후보 `FOR UPDATE`와 **직렬화**되어 lead 지정 race가 닫힌다(F-E).
- **Don't** `department` 잔존 참조를 남긴다(주석 포함). Reason: task-07 F8 게이트(`\bdepartment\b` 0건)가 drop을 막는다.
- **Don't** teamId를 검증 없이(non-empty string만 보고) 쓴다. Reason: API 직접 호출로 가짜 id는 FK 500, 비active 팀은 승인/캘린더/알림의 authz 경계가 된다(F-J). 쓰기 전 같은 tx에서 active 팀 검증(`assertActiveTeamTx`).
- **Don't** override 부여 가드를 `permissionKeys` 키 존재만으로 둔다(scope 무시). Reason: any-scope summary(task-02)면 team-scope 승인자가 키를 가지므로, 키만 보면 all-scope override를 타인에게 부여해 escalation(F-N critical). 부여 scope ≤ actor effective scope(`getEffectiveScope`)를 강제.
- **Don't** override 부여 가드(getEffectiveScope)를 쓰기 트랜잭션 **밖**에서만 호출한다. Reason: override는 권한 변경 primitive라 precheck↔write 사이 actor revoke/disable/deny가 끼면 stale actor가 부여/제거(F-Q escalation). actor 잠금+guard+create/delete를 단일 tx로(승인 task-05·매트릭스 task-06과 동일 표준).
- **Don't** 표시용에 `teamId`(cuid)를 노출. Reason: 사용자에겐 `teamName`. id는 select/PATCH 값으로만.
