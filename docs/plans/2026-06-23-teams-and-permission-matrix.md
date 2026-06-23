# 팀 모델 + scope=team 활성화 + 역할↔권한 매트릭스 편집 (구현 계획 · 엔트리포인트)

> 작성일 2026-06-23 · spec: `docs/specs/2026-06-23-teams-and-permission-matrix-design.md` · 에픽 "사용자 관리 + 접근제어" 증분 ②

**Feature:** 정식 `Team` 모델(1인 1팀)·팀장, `scope=team` 활성화(엔진+연차 소비처), 역할↔권한 매트릭스 편집기.
**Goal:** "이 사람은 자기 팀 휴가만 승인" 같은 팀 단위 권한을 부여·강제할 수 있게 한다.
**Architecture:** 기존 access 커널(`hasPermission`/`requirePermission`/`getPermissionSummary` + `computeDecision`)을 **시그니처 무변경**으로 보존하고, target-aware `getEffectiveScope`/`requirePermissionForTarget`를 **추가**한다. `User.department` 문자열을 `Team` 모델로 대체(expand→contract 마이그레이션).
**Tech Stack:** Next.js App Router, Prisma(PostgreSQL, multiSchema), vitest, zod.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-23-teams-and-permission-matrix/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

모든 task가 함께 읽는 단일 출처. task 파일은 여기를 가리키고 재인라인하지 않는다.

### PD0 — spec 대비 plan 보정(반드시 숙지)

spec은 codex 적대검증을 거쳤지만 D<n> 결정과 실제 소비처 사이에 두 가지를 plan 단계에서 **보정**한다. plan-phase review-loop가 판정한다.

- **PD1 — expand→contract 마이그레이션(department drop 시점).** spec D2/§4는 "단일 마이그레이션에서 drop"을 말한다. 그러나 split plan은 **모든 task 경계에서 typecheck/build/test가 통과**해야 한다 — `department`를 Prisma 모델에서 빼는 순간 20+ reader가 컴파일 실패한다. reader 전환은 task-04·05에 걸쳐 일어나므로 컬럼/필드는 모든 reader가 이행될 때까지 살아 있어야 한다. 따라서:
  - **task-01(expand):** `Team`+`User.teamId` 추가 + 데이터 이관(`department`→`Team`). `department` 컬럼·모델 필드 **유지**.
  - **task-04·05:** reader를 `teamId`/`team.name`으로 전환(두 필드 공존 → 컴파일 유지).
  - **task-07(contract):** `department` drop(모델 필드 제거 + drop 마이그레이션) — 직전에 F8 게이트로 잔존 참조 0 확인.
  - **D2 의도 보존:** `department`는 본 feature 머지 전에 사라진다. 단일 `stop→migrate→start` 배포가 두 마이그레이션을 `prisma migrate deploy`로 연달아 실행 → version skew 없음(F7 유지). drop 마이그레이션 전 **DB 백업**(deploy 런북 선행), **롤백=백업 복원**.
- **PD2 — scopeable resource = `leave.approval`만(F5 정합).** spec D8은 `calendar.*`·`leave.*`를 scopeable로 본다. 그러나 **통합 캘린더 피드 `/api/calendar/feed`·`/api/calendar/refresh`는 모든 `calendar.*` 뷰를 `requirePermission(view)`(all-scope 전용)로 가드하고 본 증분 이행 대상이 아니다**(§7는 연차 도메인만). 연차 캘린더(`getLeaveCalendar`)도 `leave.request:view`(all-scope `requirePermission`)로 가드된다. 따라서 이들에 team/own을 열면 정확히 F5(메뉴 노출↔API 403)가 재발한다. **본 증분에서 getEffectiveScope/requirePermissionForTarget로 실제 강제되는 소비처는 `leave.approval`(목록+액션+알림)뿐**이므로 매트릭스 편집기·부트스트랩의 scopeable 집합을 `leave.approval`로 좁힌다(D8의 anti-mismatch *의도*를 따른다). 나머지 calendar.*/leave.*는 all-only. 다른 소비처가 scope-aware로 이행하면 후속 증분에서 확장.

  **단일 SSOT 선언(F-F):** scopeable resource의 **유일 진실원은 `SCOPEABLE_RESOURCES`(task-02)**다. spec D8의 "`calendar.*`·`leave.*`가 scopeable" 열거는 **본 plan에서 `leave.approval`만으로 대체(superseded)**된다 — 그 외 resource에 team/own을 부여하려는 시도는 (a) 매트릭스 편집기가 거부(`setRoleCell`의 `allowedScopes` 가드), (b) seed/업그레이드가 all로만 시드, (c) **엔진(`getEffectiveScope`/`getPermissionSummary`)이 clamp(F-A)** — 3중으로 fail-closed. 즉 D8을 문자 그대로 따라도 비-`leave.approval` resource는 team/own이 발효되지 않아 F5(메뉴↔API 불일치)·페이지 누수가 생기지 않는다. (spec D8에 이 포인터를 남김 — 아래 ledger.)

  ```ts
  // src/kernel/access/scope.ts — 편집기·부트스트랩·업그레이드 마이그레이션 + **엔진 clamp** 공유 SSOT(F-A)
  export const SCOPEABLE_RESOURCES: Record<string, EnforceableScope[]> = {
    "leave.approval": ["all", "team"],   // view+approve가 scope-aware 소비처를 가진 유일 resource(PD2)
  };
  // 그 외 모든 resource는 ["all"]만 — 편집기가 team/own select 비활성 + 서버 setRoleCell 거부 +
  // **엔진(getEffectiveScope/getPermissionSummary)이 ALLOW 후보를 이 집합으로 clamp**(override-panel로 만든
  // 비-scopeable team/own override도 effective scope를 만들지 못함 → 메뉴/페이지/단건 누수 fail-closed 차단, PD3·F-A).
  export function allowedScopes(resource: string): EnforceableScope[] {
    return SCOPEABLE_RESOURCES[resource] ?? ["all"];
  }
  ```

### 스키마 추가 (Prisma · task-01에서 마이그레이션, task-07에서 department 제거)

```prisma
model Team {
  id         String   @id @default(cuid())
  name       String
  leadUserId String?              // 팀장 — 라우팅/알림/표시용(authz 게이트 아님, D14)
  lead       User?    @relation("TeamLead", fields: [leadUserId], references: [id], onDelete: SetNull)
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  members    User[]   @relation("TeamMembers")
  @@schema("kernel")
}

model User {
  // ... 기존 필드 유지
  // department String?   // task-01: 유지(공존), task-07: 제거(PD1)
  teamId   String?                                                   // 신규 — 1인 1팀(D1)
  team     Team?   @relation("TeamMembers", fields: [teamId], references: [id], onDelete: SetNull)
  ledTeams Team[]  @relation("TeamLead")
  // ...
  @@index([teamId])
}
```

### scope 엔진 타입·시그니처 (task-02 신설 · task-05·06 소비)

```ts
// src/kernel/access/decision.ts — 기존 타입 유지. Scope는 이미 존재:
export type Scope = "own" | "team" | "assigned" | "all";
// computeDecision는 무변경(scope=all ALLOW만 허가, DENY scope-무관 거부).

// src/kernel/access/scope.ts (신설)
export type EnforceableScope = "own" | "team" | "all";          // assigned 제외(D13)
export const SCOPE_RANK: Record<EnforceableScope, number> = { all: 3, team: 2, own: 1 };

// src/kernel/access/index.ts (추가 — 기존 hasPermission/requirePermission 무변경)
// 허가된 가장 넓은 enforceable scope. assigned는 ALLOW 후보에서 제외(F1: 미해석 scope가 좁은 유효 grant 가림 방지).
// 우선순위: OWNER→"all" / must-change·비활성→null / override DENY→null / override ALLOW(enforceable)→최광 /
//           role DENY→null / role ALLOW(enforceable)→최광 / else null.
export async function getEffectiveScope(userId: string, resource: string, action: Action): Promise<EnforceableScope | null>;

// 단건 액션 target 점검. all→허용 / team→target.teamId!=null && ===actor.teamId / own→target.ownerUserId===userId / null|assigned→거부.
export async function requirePermissionForTarget(
  userId: string, resource: string, action: Action,
  target: { teamId?: string | null; ownerUserId?: string | null },
): Promise<void>;
```

### getPermissionSummary 계약 변경 (task-02 · D5)

- **`getPermissionSummary`만** any-scope로 바꾼다: "**effective scope ≠ null**이면 키 포함"(메뉴/`useCan` 전용). `getEffectiveScope`를 재사용해 일관.
- **`hasPermission`/`requirePermission`은 무변경**(scope=all만 허가) — 공유 커널 서버 authz 가드(F2). team/own scope를 가질 수 있는 권한을 쓰는 엔드포인트만 scope-aware로 이행(§7=`leave.approval` 한정, PD2).
- **PD3 — any-scope summary 노출 경로 차단: 엔진 clamp + authz 호출부 감사(F2·F-A 필수).** any-scope 전환의 위험은 두 갈래다. ⑴ `permissionKeys.has(...)`를 **서버 데이터 가드**로 쓰는 서비스, ⑵ 서버 **페이지**가 `summary.keys.includes(...)`로 가드한 뒤 `requirePermission` 없이 직접 데이터를 읽는 패턴(`/admin/teams`·`/admin/roles` page.tsx — task-03/06). 둘 다 effective scope ≠ null이면 통과하므로, **매트릭스(D8)가 막아도 증분 ①의 `override-panel`은 임의 resource에 team/own override를 만들 수 있어** 비-scopeable resource(admin.*/workflows.*)가 노출될 수 있다(F-A high — 매트릭스만 제약하면 불충분).
  - **근본 차단(F-A FIXED) = 엔진이 `allowedScopes(resource)`로 clamp.** `getEffectiveScope`·`getPermissionSummary` **둘 다** ALLOW 후보를 resource 허용 scope로 clamp한다(task-02). 비-scopeable resource는 `["all"]`이라 team/own grant(override 포함)가 후보에서 빠져 effective scope가 `all`/`null`만 나온다 → 메뉴 키 미생성·페이지 redirect·`requirePermissionForTarget` 거부. override 데이터를 손보지 않아도 fail-closed로 안전(읽기 경계에서 중앙 차단). 이로써 "비-scopeable 키는 안전"이 **가정이 아니라 강제**가 된다.
  - **scopeable 키(`leave.approval`) 서비스 authz 감사:** `permissionKeys.has("leave.approval:*")`를 서버 데이터 가드로 쓰는 곳은 **2026-06-23 감사 결과 단 1곳** — `src/modules/leave/services/requests.ts`의 `getRequest`(`canViewPending`). task-05에서 target-aware(`getEffectiveScope`+신청자 팀)로 교체. 그 외 `permissionKeys.has(...)` authz 호출부는 non-scopeable(all-only) 키라 위 clamp로 자동 안전. `useCan`(클라 메뉴)은 D5 의도대로 노출(데이터는 scoped 엔드포인트/clamp가 강제).

### 목록 필터 패턴 (소비처 · §5 · F9)

```ts
const scope = await getEffectiveScope(userId, "leave.approval", "view");
if (!scope) throw new ForbiddenError();
if (scope === "team" && myTeamId == null) throw new ForbiddenError();  // 무소속 team-scope → 거부(F9: null 팀 필터 금지)
const where = scope === "all" ? {} : { user: { teamId: myTeamId } };   // team만 가능(own은 leave.approval 미사용)
```

### 카탈로그·권한·nav 추가 (D11 · task-03=teams, task-06=roles)

- `catalog.ts` `RESOURCES += "admin.roles", "admin.teams"`.
- `catalog.ts` `NAV` admin 트리 자식 추가: `admin-teams`(`/admin/teams`, `admin.teams:view`, task-03), `admin-roles`(`/admin/roles`, `admin.roles:view`, task-06). `seedNavigation` create-if-absent로 기존 설치 부트스트랩.
- `seed-permissions.ts` `EXTRA_PERMISSIONS += ["admin.teams","configure"], ["admin.roles","configure"]`(view는 자동).
- `seed-roles.ts` 위임 `admin` 역할: `+admin.teams:view`, `+admin.teams:configure`, `+admin.roles:view`. `admin.roles:configure`는 **어떤 역할에도 시드 안 함**(OWNER 전용, D7).

### seed 부트스트랩화 + 업그레이드 마이그레이션 (D9·D10 · task-06)

- **D9:** `seed.ts` 3단계(역할별 `deleteMany+createMany`)를 **역할 행이 0개일 때만 부트스트랩**으로 전환. 기존 행(UI 편집 포함) 보존. `ROLE_ALLOW` 값 타입 확장: `Array<string | [string, Scope]>`(cell scope 인코딩). **현 매트릭스에는 non-all scope 셀이 없다**(team-scope 승인은 "제한"=미부여 → OWNER가 편집기로 `leave.approval` team 부여). 따라서 부트스트랩은 모두 scope=`all`로 시드하고 tuple 인코딩 *능력*만 추가(PD2).
- **D10(업그레이드, 멱등 1회):** 이미 시드된 DB(RolePermission 비어있지 않음)는 D9 부트스트랩이 skip된다. 배포 시 멱등 마이그레이션이 **위임 admin의 신규 grant**(`admin.teams:view`/`admin.teams:configure`/`admin.roles:view`)를 **upsert**한다(없으면 위임 admin이 새 화면 접근 불가, F4). 현 역할엔 team scope로 *갱신*할 기존 셀이 없으므로 (a)는 vacuous, 실효는 (b) 신규 grant. **비어있지 않은 RolePermission DB 대상 테스트**.

### 팀장 불변식 (D1 · F3 · task-03)

`leadUserId` ∈ 해당 팀 **active 소속원**. teams 서비스/API가 지정 시 검증(타 팀·비active 거부), 소속 이동·비활성화로 무효가 된 lead는 `null` 정리. 알림 수신자(task-05 ④)는 이 불변식 위에서만 lead 포함.

### F8 검증 게이트 (DEFERRED_TO_IMPL · task-07 AC · 필수)

`department` drop 마이그레이션 적용 전 **마이그레이션·allowlist 외 `\bdepartment\b` 참조 == 0**(src+tests+prisma non-migration) AND `typecheck`/`build` 통과를 기계 검증. 개념적으로:

```bash
# 0건이어야 통과. prisma/migrations·docs 제외. (개념 — 실제는 allowlist 때문에 단순 rg로 부족)
rg -n "\bdepartment\b" src tests prisma --glob '!prisma/migrations/**'
```

⚠️ **단순 rg는 자기모순(F-C):** `department`를 **정당하게** 포함하는 마이그레이션 아티팩트가 src/tests/prisma에 있다 — 이관 SQL 빌더 `prisma/migrate-helpers/department-to-team.ts`, 이관/ drop 적합성 테스트 `tests/prisma/team-migration.test.ts`, 게이트 자체 테스트 `tests/scripts/check-no-department.test.ts`. 이들은 reader가 아니라(런타임에 컬럼을 읽지 않음) drop과 무관하므로 rg가 잡으면 게이트가 영원히 실패한다. 그래서 게이트는 **명시 ALLOWLIST**(위 3파일, 각 정당 사유 주석)로 이들을 제외하고, **나머지 전부에서 0건**을 요구한다. reader를 allowlist에 넣는 것은 금지(F8 무력화). `scripts/check-no-department.mjs`가 이 로직을 구현하고 `WORD`/`ALLOWLIST`/`findHits`를 export해 자체 테스트가 실제 동작을 검증(task-07). CI/AC에서 `npm run check:no-department` 호출.

### 감사 로그 패턴 (task-03·06)

권한·팀 변경은 `prisma.auditLog.create({ data: { actorId, entityType, entityId, action, metadata } })`. 매트릭스 셀 변경 metadata에 `{ before:{effect,scope}, after:{effect,scope} }`.

---

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | Team 스키마 + expand 마이그레이션(department→Team) | [ ] | [task-01](2026-06-23-teams-and-permission-matrix/task-01-team-schema.md) | — | |
| 02 | scope 엔진(getEffectiveScope/requirePermissionForTarget) + summary any-scope | [ ] | [task-02](2026-06-23-teams-and-permission-matrix/task-02-scope-engine.md) | 01 | |
| 03 | 팀 관리(catalog admin.teams + service/repo 불변식 + /admin/teams API·UI) | [ ] | [task-03](2026-06-23-teams-and-permission-matrix/task-03-team-management.md) | 01 | |
| 04 | 사용자관리 department→teamId 이행 + signup 필드 제거 | [ ] | [task-04](2026-06-23-teams-and-permission-matrix/task-04-user-team-transition.md) | 01, 03 | |
| 05 | 연차 소비처 이행(캘린더 teamId + 승인 scope-aware + 알림 수신자) | [ ] | [task-05](2026-06-23-teams-and-permission-matrix/task-05-leave-consumer-migration.md) | 01, 02 | |
| 06 | 매트릭스 편집기(catalog admin.roles + service/API/UI + seed 부트스트랩 + 업그레이드 마이그레이션) | [ ] | [task-06](2026-06-23-teams-and-permission-matrix/task-06-matrix-editor.md) | 02, 03 | |
| 07 | department drop(contract 마이그레이션) + F8 게이트 + 통합/보안 테스트 | [ ] | [task-07](2026-06-23-teams-and-permission-matrix/task-07-department-drop-gate.md) | 04, 05, 06 | |

## 빌드 순서·의존(spec §11)

1(스키마) → 2(엔진, 1에 의존) → 3(팀관리, 1) → 4(사용자, 1·3) → 5(연차, 1·2) → 6(매트릭스, 2·3) → 7(drop·게이트, 모든 reader 전환 후). 3·4·5는 1·2 이후 병렬 가능. **7은 반드시 마지막**(F8 게이트가 4·5·6의 reader 전환 완료를 전제).

## review-loop 이월

**spec phase(F1~F9)** — 모두 spec에서 FIXED/ACCEPTED. plan AC로 연결: **F8**(task-07 게이트), **F9**(task-05 무소속 team-scope fail-closed 테스트), **F3**(task-03 교차팀 lead 거부 테스트), **F4**(task-06 비-empty RolePermission 업그레이드 마이그레이션 테스트), **F2/F5**(task-02·06 보안 negative: team-scope만 가진 사용자 → 메뉴 노출되나 unscoped `requirePermission` 거부; 비-scopeable resource team/own 비활성), **PD3**(task-05 `getRequest` 단건 상세 target-aware — any-scope summary 과허가 차단).

**plan phase(2026-06-23, codex 적대검증)** — 미판정 blocking 0으로 종료. FIXED:
- **F-A**(high, R1) — any-scope summary가 비-scopeable resource의 team/own override를 노출(서버 페이지가 summary 키로 가드 후 직접 데이터 읽기). → 엔진(`getEffectiveScope`/`getPermissionSummary`)이 `allowedScopes(resource)`로 clamp(task-02 + 보안 negative). PD3·PD2 갱신. **R2 부재 → 확정.**
- **F-C**(medium, R1) — F8 게이트가 자체 테스트·이관 헬퍼와 충돌(영원히 실패)·prisma 스캔 누락. → 명시 ALLOWLIST(마이그레이션 아티팩트) + 스캔 범위 계약 일치 + 로직 export해 자체 테스트가 실제 동작 검증(task-07). **R2 부재 → 확정.**
- **F-B→F-D**(high, R1→R2) — 승인 target authz가 상태변경 트랜잭션 밖 → 팀 재배정 TOCTOU. R1은 applicant만 잠금했으나 R2가 **actor 팀 stale** 지적. → `approveTx`/`rejectRequest`가 **actor·applicant 두 행을 id 순서로 `FOR UPDATE` 잠그고 현재 teamId 비교**(precomputed teamId 폐기, task-05 + actor·applicant 재배정 회귀 테스트).
- **F-E**(high, R2) — 팀장 지정의 후보 검증(plain read)과 leadUserId 쓰기 사이 동시 멤버 이동 → 교차팀 lead(F3 누수 race 재현). → `updateTeam`이 후보 user 행을 `FOR UPDATE` 잠근 뒤 검증; task-04 teamId UPDATE+reconcile(같은 tx)과 직렬화(task-03 + 잠금-우선 순서 테스트).
- **F-G**(high, R3) — 직접입력(`POST /api/admin/leave/requests`·picker `/api/admin/leave/users`, all-scope `leave.approval:approve`)이 task-05 미이행 → any-scope summary로 team-scope 승인자에게 버튼 노출되나 라우트 403(F5-class). → 직접입력=create+자동승인은 all-scope 전용으로 유지하고 UI 트리거를 **effective-scope-all**로 게이트(task-05 §5b + negative). 라우트는 all-scope 불변(fail-closed).
- **F-H**(high, R3) — 매트릭스 쓰기 OWNER authz(`assertOwner`)가 `setCell` 트랜잭션 **밖** → precheck 이후 강등돼도 stale 권한으로 god-power 변경. → `setCell` tx 내부에서 actor 행 `FOR UPDATE` 잠금 + OWNER 재확인(task-06 + stale-OWNER 회귀 테스트). (F-D/F-E와 동일 in-tx-authz 패턴, 최고위험 op.)
- **F-F**(high, R3, **ACCEPTED**) — spec D8(`calendar.*`/`leave.*` scopeable)과 plan PD2(`leave.approval`만)의 교차문서 모순 재지목. **근거:** PD2가 의도된 보정이고, scopeable SSOT=`SCOPEABLE_RESOURCES`(task-02) + 매트릭스 가드 + 엔진 clamp(F-A)로 비-`leave.approval`은 3중 fail-closed. **보완:** PD2를 단일 SSOT로 명시 + spec D8에 보정 포인터 1줄. (D8 broader 열거를 따라도 발효 안 됨 → 안전.)

- **F-I**(high, R4) — 최종 게이트(check:no-department/typecheck/lint/test/build)가 `db:seed`를 누락 → 기존 DB가 게이트 통과해도 catalog/nav/D10 grant 미생성, 위임 admin 잠김. → task-07에 배포 계약(migrate deploy → **db:seed** → smoke) 명시 + Permission/Nav/grant 존재 smoke AC.
- **F-J**(high, R4) — user teamId 검증이 non-empty string만 → 임의 id FK 500·비active 팀이 authz 경계화. → 쓰기 전 같은 tx에서 active-team 검증(`assertActiveTeamTx`, task-04 create/approve/update) + UserValidation(400) + negative 테스트.
- **F-K**(medium, R4) — `applyTeamsPermissionUpgrade`가 전제(admin 역할·grant 권한) 누락 시 skip하고도 플래그 set(fail-open) → 영구 미적용. → fail-closed throw + 플래그는 모든 upsert 후 + seed가 `$transaction`으로 원자화(task-06 + 누락 throw 테스트).

**in-tx-authz 패턴(F-D/F-E/F-H) 관측:** "authz 점검을 mutating 트랜잭션 밖에서 함" 계열이 3개 surface(승인·팀장·매트릭스)에서 반복 → 가변 멤버십/권한 race. 모두 동일 패턴(행 `FOR UPDATE` 잠금 + tx 내부 재확인)으로 닫음. 추가 surface가 또 나오면 class 판정(ACCEPTED — 단일 인스턴스·admin-only·감사 가능).

- **F-L**(high, R5) — pm `*` 와일드카드 확장이 OWNER 전용 `admin.roles:configure`를 fresh seed에 부여 → D7 위반·god-power escalation. → `expandRoleCells`가 `OWNER_ONLY_KEYS`를 확장에서 제외(seed-roles.ts 순수 헬퍼 + 어떤 역할도 미보유 테스트, task-06).
- **F-M**(high, R5) — 이관 테스트가 helper(`expandMigrationSql`)만 검증하고 손복사 배포 `migration.sql`은 미검증 → drift 시 kernel 정규화·단언·FK 누락 → drop이 잘못된 매핑 위에서 일어나 데이터 손상. → team-migration.test가 실제 `migration.sql`을 읽어 helper 핵심 조각·정규화·순서 정합 단언(task-01).

R1~R5에서 F-A~F-M(13건) 닫음(12 FIXED·1 ACCEPTED). 각 라운드 신규 finding은 다른 부위의 실제 갭(re-flag 아님 — 앞 라운드 finding은 후속 라운드에서 모두 소거 확인). **max=5 도달.** F-L/F-M 수정은 적용됐으나 6번째 codex 재검은 max 초과라 미실행 — 두 fix는 명확·기계적(키 제외 / .sql 바인딩 테스트)이라 재검 없이 확정. 종료: 미판정 blocking 0(12 FIXED·1 ACCEPTED).
