# 팀 모델 + scope=team 활성화 + 역할↔권한 매트릭스 편집 (설계 spec)

> 작성일 2026-06-23 · 상태: 설계 초안 · 에픽 "사용자 관리 + 접근제어"의 **증분 ②**

## 1. 배경과 목적

`ops-hub`는 접근제어 기반(스키마·권한 엔진·개인 override UI)과 사용자 관리(증분 ①)·메뉴 CMS(증분 ③)를 갖췄다. 남은 증분 ②는 **조직 단위(팀)와 팀 단위 권한**이다. 현재 두 가지가 비어 있다.

1. **팀 개념이 정식 모델이 아님.** 유일한 그룹 키는 `User.department String?` 문자열이고, 연차 캘린더 팀 뷰가 이 문자열 매칭으로 동작한다(`src/modules/leave/services/calendar.ts`).
2. **`scope`가 죽은 필드.** `RolePermission.scope`·`UserPermissionOverride.scope`는 저장·UI 입력(`override-panel.tsx`)은 되지만 `src/kernel/access/decision.ts`의 `computeDecision`이 **`scope=all` ALLOW만 허가로 인정**한다. `team`/`own`/`assigned`는 아무것도 허가하지 못한다(전역 검사라 target 컨텍스트가 없음). 즉 "이 사람은 자기 팀 휴가만 승인" 같은 세분화가 불가능하다.

본 증분은 (a) 정식 `Team` 모델 + 1인 1팀 소속, (b) `scope=team`/`own` 활성화(엔진+소비처), (c) 역할↔권한 매트릭스 편집기를 도입해 **권한을 팀 단위로 좁혀 부여**할 수 있게 한다.

### 재사용 대상(기존 기반)

- 권한 엔진: `src/kernel/access/index.ts`(`hasPermission`/`requirePermission`/`getPermissionSummary`), `decision.ts`(`computeDecision`, Deny우선·fail-closed, ADR-0002), `catalog.ts`(`RESOURCES`/`ACTIONS`/`ACCESS_ROLE_KEYS`/`NAV`)
- 스키마: `AccessRole`·`Permission`·`RolePermission`(`@@unique([roleId, permissionId, scope])`, `effect: PermissionEffect`, `scope: String @default("all")`)·`UserPermissionOverride`·`User.department`
- 시드: `prisma/seed.ts`(역할별 RolePermission 재삽입), `seed-roles.ts`(`ROLE_ALLOW`), `seed-permissions.ts`(`EXTRA_PERMISSIONS`), `seed-navigation.ts`(create-if-absent)
- 메뉴 CMS(증분 ③, nav D3): 코드 NAV는 1회 부트스트랩, 이후 DB가 진실원 — 본 증분도 같은 패턴을 매트릭스에 적용
- 개인 override CRUD UI(증분 ①): `src/app/(app)/admin/users/[id]/_components/override-panel.tsx`(scope select 선례)
- 트랜잭션·감사 패턴(증분 ①): status-CAS, `AuditLog`

## 2. 증분 범위

본 작업은 "사용자 관리 + 접근제어" 에픽의 **3증분 중 ②번**이다(①·③ 완료).

- ① 계정 수명주기 + 관리자 사용자 관리 (완료)
- **② (본 spec)** 팀 모델 + 팀별 권한 (`Team`·소속·`scope=team` 활성화 + 역할↔권한 매트릭스 편집)
- ③ 메뉴 CMS (완료)

### 포함 (IN)

`Team` 모델 + 1인 1팀 소속(`User.teamId`) + 팀장(`leadUserId`), `department`→`Team` 마이그레이션, 팀 관리 UI/API(`/admin/teams`), 사용자↔팀 배정(user-edit), `scope=team`/`own` 해석 엔진(`getEffectiveScope`·`requirePermissionForTarget`) + 메뉴/데이터 분리, 소비처 이행(연차 승인 목록·승인·캘린더 팀뷰·알림 수신자), 역할↔권한 매트릭스 편집기(`/admin/roles`, `admin.roles` 권한, OWNER-only configure, 감사로그), seed 부트스트랩화 + 기존 설치 1회 scope 마이그레이션.

### 제외 (OUT — 후속/별도)

역할(AccessRole) 생성/이름변경/삭제 UI(매트릭스는 기존 6역할 편집만), `scope=assigned` 해석(미해석 유지), 다중 팀 소속, 팀 계층(상위팀), 부서별 승인자 체인/다단 승인, 워크플로 영역의 scope 재설계(연차·캘린더 외 소비처는 본 증분 미대상), conditions(Json) 정책 엔진 확장.

## 3. 결정 기록 (Decisions)

| # | 결정 |
| --- | --- |
| **D1** | **Team 모델 = `department` 대체 · 1인 1팀 · 팀장.** `User.teamId String?`(소속, 최대 1팀), `Team.leadUserId String?`(팀장). 팀장은 **인가 게이트가 아니라** 승인 라우팅·알림 기본 수신자·표시용 메타데이터다(D14). Team은 `id`/`name`/`leadUserId`/`active`로 최소화하고 코드에서 key로 참조하지 않는다(AccessRole과 달리 순수 데이터, id 참조). **팀장 불변식**: `leadUserId`는 그 팀의 **active 소속원**이어야 한다(teams 서비스/API가 강제, 임의 사용자 지정 거부; 소속 이동·비활성화로 무효가 된 lead는 `null`로 정리). 알림 수신자에 lead가 포함되므로(D12 ④) 이 불변식이 없으면 교차팀 데이터 누수(F3). |
| **D2** | **마이그레이션 = distinct `department` → `Team`.** 비-null `department` 고유값마다 `Team`(name=department) 생성, 해당 사용자 `teamId` 연결. `department`가 null인 사용자는 무소속. 이관 후 `department` 컬럼은 **같은 마이그레이션에서 drop**(소규모 운영·단순; §Open에서 재확인). |
| **D3** | **scope 해석 = effective-scope 리졸버(방식 A).** 신설 `getEffectiveScope(userId,resource,action) → "all"\|"team"\|"own"\|null`: `computeDecision` 우선순위를 일반화해 **허가된 가장 넓은 scope**를 반환한다. **해석 가능한 scope만 후보**(rank: all>team>own)이고 `assigned`는 미구현(D13)이라 **ranking에서 제외**한다 — 그래야 미해석 scope가 더 좁은 유효 grant(`own`/`team`)를 가리지 않는다(예: 같은 권한에 `ALLOW assigned`+`ALLOW own`이면 `own` 선택; `assigned`만 있으면 미허가→`null`). 신설 `requirePermissionForTarget(userId,resource,action,target)`: effective scope로 target(`{teamId?, ownerUserId?}`)을 점검. **DENY는 scope-무관 거부**(보수적, 기존 `computeDecision` 의미 유지). 엔진 시그니처 전면 변경(target-aware) 대신 추가 함수로 — blast radius 최소, `calendar.ts`의 department 필터 패턴을 `teamId`로 일반화하는 것과 동형. |
| **D4** | **2단계 검사 분리(보안 핵심).** 기존 `requirePermission(userId,resource,action)`은 **scope=all만 허가로 인정**하는 의미를 **유지**한다 — target 컨텍스트 없이 데이터 전체를 다루는(unscoped) 엔드포인트를 team-scope 상승으로부터 보호한다(team scope 부여가 전역 권한을 만족시키지 않음). target/목록을 다루는 엔드포인트만 `getEffectiveScope`/`requirePermissionForTarget`로 전환하고 **데이터 필터를 강제**한다. |
| **D5** | **메뉴 노출 ≠ 데이터 범위(API 계약 분리).** 메뉴/`useCan` 전용인 **`getPermissionSummary`만** "어떤 enforceable scope로든 허가되면 키 포함"으로 바꾼다 — team-scope만 가진 사용자도 메뉴를 본다. **`hasPermission`/`requirePermission`의 계약은 바꾸지 않는다**(여전히 scope=all만 허가) — 둘은 공유 커널의 서버 authz 가드이고 `requirePermission`이 `hasPermission` 기반이라, any-scope로 바꾸면 기존 모든 호출부가 target 필터 없이 team/own grant를 통과시켜 좁히려던 권한이 unscoped allow가 된다(F2, D4 자기모순). 실제 데이터 범위는 scoped 엔드포인트가 `getEffectiveScope`/`requirePermissionForTarget`로 강제. team/own scope를 가질 수 있는 권한을 쓰는 엔드포인트는 반드시 scope-aware로 이행(§7), 그 외엔 전역 `requirePermission`(all-scope) 유지. 기존 `hasPermission` 직접 호출부는 감사해 서버 authz면 all-scope 유지 또는 scope-aware 전환(§7). |
| **D6** | **매트릭스 편집기 범위 = 기존 역할 권한 편집만.** 역할(AccessRole) 집합(6종: pm·admin·개발 4종)은 고정, 생성/삭제는 범위 외(코드 `ACCESS_ROLE_KEYS` 참조·직무별 자동부여·고아 역할 회피). 셀 = `none`/`ALLOW`/`DENY` + `scope`. `pm`(`*`) 역할 행은 read-only(OWNER 안전). |
| **D7** | **매트릭스 변경 가드 = OWNER-only.** 신설 `admin.roles:configure`는 라우트 키 검사와 **별개로 서비스 계층에서 OWNER만** 허용한다(역할의 의미 자체를 재정의하는 최상위 권한 — D8/D12/D13 anti-escalation 철학). 위임 `admin`은 `admin.roles:view`만. 모든 셀 변경은 **`AuditLog`**(before/after effect·scope) 필수. |
| **D8** | **scope 선택 제약(소비처 정합).** 매트릭스 편집기의 `team`/`own` 허용은 **본 증분에서 scope-aware로 이행하는 resource만** — `calendar.*`·`leave.*`(§7). `admin.*`·`integrations.*`·**`workflows.*`는 `all`만**(team/own 비활성). workflow scope 재설계는 OUT이라 소비처가 scope-aware가 아니므로, team/own을 열면 메뉴는 보이는데 unscoped workflow API가 403 나는 불일치가 생긴다(F5). 편집기가 옵션을 제한하고, 우회해도 fail-closed(D4). workflow scope는 후속 증분에서 소비처와 함께 연다. |
| **D9** | **seed 부트스트랩화(nav D3 패턴).** `seed.ts` 3단계의 역할별 `deleteMany+createMany`(매 배포 코드값으로 덮어씀)를 **역할 행이 0개일 때만 부트스트랩**으로 전환. 기존 행(UI 편집 포함)은 보존. F1(stale ALLOW 누수)의 논리는 역전된다 — 부트스트랩 후 **DB가 진실원**이고 코드 `ROLE_ALLOW`는 초기 1회 시드일 뿐이므로, 코드에서 키를 빼도 운영 권한을 바꾸지 않는다(의도). `ROLE_ALLOW`는 cell별 scope를 담도록 인코딩 확장(`Array<string \| [string, Scope]>`). |
| **D10** | **기존 설치 업그레이드 = 1회 멱등 데이터 마이그레이션.** 이미 시드된 DB는 RolePermission이 비어있지 않아 D9 부트스트랩이 skip된다. 본 증분 배포 시 멱등 마이그레이션 1회로 **(a)** base 시스템 역할(`isSystem`)의 의도된 셀을 `team` scope로 갱신 **+ (b) D11이 새로 도입한 grant(위임 `admin`의 `admin.teams:view`·`admin.teams:configure`·`admin.roles:view` 등)를 upsert**한다 — (b)가 없으면 업그레이드 DB에서 위임 admin이 새 화면(팀/매트릭스 관리)에 접근 못 하고 OWNER가 수동 복구해야 함(F4). **비어있지 않은 RolePermission DB를 대상으로 테스트**. 이후 UI가 진실원. |
| **D11** | **권한 카탈로그·nav 보강.** `RESOURCES += "admin.roles","admin.teams"`; `EXTRA_PERMISSIONS += ["admin.roles","configure"],["admin.teams","configure"]`(view는 자동). `NAV` admin 트리에 `/admin/roles`(권한 매트릭스), `/admin/teams`(팀 관리) 자식 추가 — `seedNavigation` create-if-absent로 기존 설치에도 부트스트랩됨. 사용자↔팀 배정은 별도 권한 없이 `admin.users:update`(user-edit)에 `teamId` 필드 추가. |
| **D12** | **소비처 이행.** ① 연차 승인 목록(`/api/admin/leave/approvals` → 무필터 전체 PENDING): `getEffectiveScope(leave.approval,view)` → `all`=전체·`team`=`WHERE user.teamId=내팀`·기타=거부. ② 승인 액션: `requirePermissionForTarget(leave.approval,approve,{teamId: 신청자.teamId})`. ③ 연차 캘린더 팀뷰(`calendar.ts`): `department` 문자열 매칭 → `teamId` 매칭. ④ 알림 수신자(`getLeaveAdminRecipients`): all-scope 승인자 + 신청자와 같은 팀의 team-scope 승인자 + 팀장. |
| **D13** | **`scope=assigned` 미해석.** 본 증분은 `all`/`team`/`own`만 해석한다. `assigned`는 `getEffectiveScope`의 ALLOW 후보에서 **제외**되어(D3) 좁은 유효 grant(`own`/`team`)를 가리지 않는다 — `assigned`만 부여된 권한은 effective scope가 **`null`**(메뉴 미노출·API 거부 일관, fail-closed). 편집기에서도 비활성(미래 워크플로 배정 모델까지 보류). |
| **D14** | **팀장은 authz 비게이트.** `leadUserId`는 알림/승인 라우팅 기본값·UI 표시일 뿐 인가 결정에 쓰지 않는다(D1 재확인). 매트릭스 편집은 OWNER `systemRole`에 영향이 없어(OWNER는 엔진에서 항상 허용) 관리자 lockout 경로를 새로 만들지 않는다 — 최소 OWNER 보존은 기존 user-management D12로 유지. |

## 4. 데이터 모델 / 마이그레이션

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
  // department String?  →  마이그레이션에서 Team으로 이관 후 drop(D2)
  teamId   String?                                                    // 신규 — 1인 1팀(D1)
  team     Team?   @relation("TeamMembers", fields: [teamId], references: [id], onDelete: SetNull)
  ledTeams Team[]  @relation("TeamLead")                              // 팀장으로 있는 팀들
  // ...
  @@index([teamId])
}
```

**마이그레이션 순서(D2)** — 하나의 Prisma migration 안에서:
1. `Team` 테이블 생성 + `User.teamId` 컬럼 추가
2. 데이터 이관(raw SQL): `INSERT INTO kernel."Team"(id,name,...) SELECT … FROM (SELECT DISTINCT department FROM "User" WHERE department IS NOT NULL)`; 이어서 `UPDATE "User" SET teamId = (매칭 Team)`
3. `User.department` 컬럼 drop
4. `leadUserId`는 마이그레이션에서 비움(팀장은 이후 `/admin/teams`에서 지정)

**적합성 검증(테스트/스크립트)**: 이관 후 (구 department별 사용자 집합) == (신 teamId별 사용자 집합), null department → null teamId.

## 5. scope 해석 엔진 (D3·D4·D5)

`src/kernel/access/`에 추가(기존 `hasPermission`/`requirePermission` 시그니처 무변경):

```ts
type Scope = "own" | "team" | "assigned" | "all";
type EnforceableScope = "own" | "team" | "all";                  // requirePermissionForTarget이 강제 가능한 scope
const SCOPE_RANK: Record<EnforceableScope, number> = { all: 3, team: 2, own: 1 };
// assigned는 해석 불가(D13) → ALLOW 후보에서 제외(필터). 미구현 scope가 좁은 유효 grant를 가리지 않게.
const enforceable = (rules) => rules.filter((r) => r.scope !== "assigned");

// 허가된 가장 넓은 enforceable scope. computeDecision 우선순위의 일반화.
async function getEffectiveScope(userId, resource, action): Promise<EnforceableScope | null> {
  // OWNER → "all"
  // (must-change/비활성 → null, 기존 fail-closed 게이트 유지)
  // override DENY 있으면 → null
  // enforceable(override ALLOW) 있으면 → 그 중 최광 scope (assigned 제외)
  // role DENY 있으면 → null
  // enforceable(role ALLOW) 있으면 → 그 중 최광 scope (assigned 제외)
  // else null  (assigned만 있는 권한도 여기로 → 미허가)
}

// target 점검. 목록이 아니라 단건 액션용.
async function requirePermissionForTarget(userId, resource, action, target: { teamId?, ownerUserId? }): Promise<void> {
  const scope = await getEffectiveScope(userId, resource, action);
  // all  → 허용
  // team → target.teamId != null && target.teamId === actor.teamId
  // own  → target.ownerUserId === userId
  // assigned/null → 거부(D13)
}
```

**메뉴/요약(D5)**: **`getPermissionSummary`만** "**effective scope ≠ null** = 키 포함(메뉴 노출)"으로 바꾼다(메뉴/`useCan` 전용). **`hasPermission`/`requirePermission`은 무변경 — scope=all만 허가**(공유 커널 서버 authz 가드). `requirePermission`은 `hasPermission` 기반이므로 둘을 함께 all-scope로 유지해야 D4가 성립한다. 메뉴 노출과 서버 authz를 **다른 API로 분리**한다(F2).

**목록 필터 패턴(소비처)**:
```ts
const scope = await getEffectiveScope(userId, "leave.approval", "view");
if (!scope) throw new ForbiddenError();
const where = scope === "all" ? {} : scope === "team" ? { user: { teamId: myTeamId } } : { userId };
```

## 6. 역할↔권한 매트릭스 편집기 (D6·D7·D8·D9)

- 라우트 `/admin/roles`, 권한 `admin.roles:view`(매트릭스 로드)·`admin.roles:configure`(변경, **OWNER-only 서비스 강제**, D7)
- UI: 행=AccessRole(6), 열=권한(`resource:action`, resource로 그룹). 셀 상태 = `none`/`ALLOW`/`DENY` + scope select(D8 분류대로 옵션 제한). `pm` 행 read-only.
- API:
  - `GET /api/admin/roles/matrix` → `{ roles, permissions(카탈로그), rules: RolePermission[] }`
  - `PUT /api/admin/roles/:roleId/permissions/:permissionId` body `{ effect: "none"|"ALLOW"|"DENY", scope }` → **트랜잭션**: `deleteMany({roleId,permissionId})`(scope가 unique 키의 일부라 scope 변경=치환) 후 `none`이 아니면 1행 create. `AuditLog` 기록. OWNER-only·`pm` read-only·scope 제약 가드.
- **seed 부트스트랩화(D9)**: `seed.ts` 3단계를 "역할 행 0개일 때만 `ROLE_ALLOW`로 부트스트랩"으로 변경. `ROLE_ALLOW` 값에 cell scope 인코딩(`access-control.md` 매트릭스의 팀/배정 셀 → `team`, 전체 셀 → `all`). 구체 scope 값(특히 "제한" 셀)은 plan에서 확정.

## 7. 영향받는 소비처(이행 대상, D5·D12)

team/own scope를 가질 수 있는 권한을 쓰므로 **반드시 scope-aware로 전환**(아니면 메뉴/API 불일치):

| 소비처 | 현재 | 이행 후 |
| --- | --- | --- |
| 연차 승인 목록 `/api/admin/leave/approvals` | `requirePermission(leave.approval,view)` + 무필터 전체 PENDING | `getEffectiveScope` → all=전체·team=`WHERE user.teamId=내팀` |
| 연차 승인 액션(`approveTx`/reject) | 전역 권한 검사 | `requirePermissionForTarget(...,{teamId: 신청자.teamId})` |
| 연차 캘린더 팀뷰 `calendar.ts` | `department` 문자열 매칭(`canCrossDepartment` ad-hoc) | `teamId` 매칭 + scope를 `getEffectiveScope`에서 도출 |
| 연차 알림 수신자 `getLeaveAdminRecipients` | `hasPermission`(scope 무시) | all-scope 승인자 + 같은 팀 team-scope 승인자 + 팀장 |

전역 `requirePermission`을 그대로 쓰는 unscoped 엔드포인트(`admin.*`·`integrations.*`·workflows 생성/발송 등)는 **변경하지 않는다**(D4 보호 유지). 또한 `hasPermission`을 **서버 authz로 직접 쓰는 호출부**(예: 위 `getLeaveAdminRecipients`)는 감사해 all-scope 의미를 유지하거나 scope-aware로 전환한다 — any-scope로 새면 안 된다(F2). 메뉴 노출만 `getPermissionSummary`(any-scope)로 분리.

**`department` 컬럼 drop(D2)에 따른 필수 동반 수정** — 컬럼을 읽는 코드는 전부 `team`(`teamId`/`team.name`)으로 전환해야 한다(누락 시 typecheck/런타임 깨짐):

| 위치 | 현재 `department` 사용 | 이행 |
| --- | --- | --- |
| `src/modules/leave/services/requests.ts` | 승인 큐 상세에 `department` select·표시 | `team: { select: { name } }` |
| `src/modules/leave/services/status.ts` | 직원 현황 export select | `team.name`(또는 teamId) |
| `src/app/(app)/leave/_components/status-client.tsx` | 부서 드롭다운 필터(고유 department 추출) | 팀 목록 기반 필터 |

이 세 곳은 권한 scope와 무관하지만 D2 마이그레이션이 컬럼을 제거하므로 **같은 PR에서 함께 이행**해야 한다.

## 8. 권한 카탈로그·네비게이션 (D11)

- `catalog.ts`: `RESOURCES += "admin.roles","admin.teams"`. `NAV` admin 트리 자식에 `admin-roles`(`/admin/roles`, `admin.roles:view`), `admin-teams`(`/admin/teams`, `admin.teams:view`) 추가.
- `seed-permissions.ts`: `EXTRA_PERMISSIONS += ["admin.roles","configure"],["admin.teams","configure"]`.
- `seed-roles.ts`: 위임 `admin` 역할에 `admin.teams:view`/`admin.teams:configure`/`admin.roles:view` 부여(매트릭스 configure는 OWNER-only라 미부여). `admin.roles:configure`는 어떤 역할에도 ALLOW로 시드하지 않음(OWNER 전용).
- 팀 관리 UI `/admin/teams`: 팀 목록·생성·이름변경·팀장 지정·active 토글(`admin.teams:configure`). 사용자↔팀 배정은 user-edit의 `teamId`(`admin.users:update`).

## 9. 가드·불변식

- 매트릭스 `configure`: **OWNER-only**(서비스 계층), `pm` 행 read-only, scope 옵션 제약(D8). 모든 변경 감사로그.
- `requirePermissionForTarget`: target 누락/`assigned`/`null` → **fail-closed 거부**.
- 전역 `requirePermission`: scope=all만 허가(D4) — team-scope 상승 차단.
- seed 부트스트랩 멱등: 재시드가 비어있지 않은 역할을 건드리지 않음(UI 편집 보존).
- 팀장 불변식(D1·F3): `leadUserId` ∈ 해당 팀 **active 소속원**. teams API가 지정 시 검증(타 팀·비active 거부), 소속 이동·비활성화로 무효가 된 lead는 `null` 정리. 알림 수신자 계산은 이 불변식 위에서만 lead를 포함한다.
- 마이그레이션: `teamId`/`leadUserId` FK `onDelete: SetNull`(팀 삭제 시 소속/팀장 참조 정리). 최소 OWNER 보존은 기존 D12로 유지(D14).

## 10. 테스트 전략

- **단위(엔진)**: `getEffectiveScope` 우선순위(OWNER, override DENY/ALLOW, role DENY/ALLOW, 최광 scope 선택), `requirePermissionForTarget`(team 일치/불일치, own, assigned·null 거부). **assigned 비가림(필수)**: `ALLOW assigned`+`ALLOW own` 공존 → effective=`own`(assigned가 가리지 않음), `ALLOW assigned`+`ALLOW team` → `team`, `assigned` 단독 → `null`(미허가).
- **보안 negative(필수)**: ① team-scope만 가진 사용자 → 메뉴 키 노출되지만(`getPermissionSummary`) 전역 `requirePermission` unscoped admin 액션은 **거부**(상승 차단). ② team-scope 승인자 → 자기 팀 PENDING만 목록·승인, 타 팀 신청 승인 **403**. ③ all-scope 승인자 → 전체.
- **seed 멱등 + 업그레이드(F4)**: 재시드가 UI 편집 매트릭스를 보존(부트스트랩-if-empty). **비어있지 않은 RolePermission DB**에 D10 마이그레이션 적용 → 위임 admin이 `admin.teams`/`admin.roles:view` grant 획득 + 의도된 셀 team scope 갱신(멱등 재적용 무해).
- **팀장 누수 방지(F3)**: 타 팀·비active 사용자를 lead로 지정 시 거부, lead가 팀 이동/비활성화되면 정리되어 알림 수신자에서 제외.
- **scopeable 정합(F5)**: 편집기에서 `workflows.*`·`admin.*`·`integrations.*`는 team/own 비활성(all-only) → 메뉴/API 불일치 없음.
- **마이그레이션 정합성**: department→Team 집합 일치, null→null.
- **매트릭스 API**: OWNER-only(위임 admin 403), 감사로그 기록, 셀 set/clear/scope 치환.

## 11. 빌드 순서(plan 분할 가이드)

1. **Team 스키마 + 마이그레이션**(department→Team) + 팀 관리 UI/API + user-edit 팀 배정
2. **scope 엔진**(`getEffectiveScope`/`requirePermissionForTarget` + 메뉴 any-scope) + 단위·보안 테스트
3. **소비처 이행**(연차 승인 목록·액션·캘린더 팀뷰·알림 수신자)
4. **매트릭스 편집기**(UI/API + `admin.roles`/`admin.teams` 카탈로그·nav + seed 부트스트랩화 + 1회 scope 마이그레이션)
5. 통합 테스트 + review-loop

2는 1에, 3·4의 scope 편집 의미는 2에 의존.

## 12. Open decisions (plan에서 확정)

- `department` 컬럼 즉시 drop(권장) vs 한 릴리스 deprecated 유지
- `access-control.md` "제한" 셀들의 구체 scope/effect 정책(bootstrap 기본값) — 로드맵 §주요 설계 결정 3·4와 연결
- 알림 수신자(team-scope 승인자) 정밀 규칙 — 팀장 always 포함 여부
- 매트릭스 동시편집 동시성: per-cell last-write-wins + 감사(권장, OWNER 단독 편집이라 충분) vs `updatedAt` 낙관락 추가
