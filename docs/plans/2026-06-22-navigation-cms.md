# 메뉴 관리 (Navigation CMS) — 구현 계획 (엔트리포인트)

> 작성일 2026-06-22 · 스펙: `docs/specs/2026-06-22-navigation-cms-design.md`(결정 `D1~D17`, ledger `§13`) · 실행: `superpowers:subagent-driven-development`
> 본 계획은 스펙을 **빠짐없이** 구현한다. 스펙 결정과 충돌하는 듯한 finding은 버그가 아니라 의도된 설계다(스펙 §3 대조).

## Goal

관리자가 화면에서 사이드바 메뉴를 추가·수정·삭제·정렬하고 메뉴별 필요권한을 지정하며, 2단(대/중) 중메뉴를 사이드바 아코디언으로 노출한다. 메뉴 SSOT를 코드에서 DB로 이관한다.

## Architecture

Next.js App Router 모듈형 모놀리스의 기존 계층(Route Handler → Service → Repository → Prisma)을 그대로 따른다. 읽기 경로(`kernel/navigation` + `app-nav.tsx`)는 평면→2단 트리로 확장하고, 쓰기 경로는 신규 모듈 `modules/admin/navigation/{validations,repositories,services}` + 라우트 `app/api/admin/navigation/*` + 관리 화면 `app/(app)/admin/navigation/*`로 구성한다. 권한은 UI `useCan` ↔ 서버 `authorize`/`requirePermission`이 동일 키(`admin.navigation:view`/`configure`)를 공유한다.

## Tech Stack

TypeScript · Next.js(App Router) · Prisma(PostgreSQL, multiSchema `kernel`) · zod · vitest(node 환경, prisma 모킹·순수 로직 추출). 신규 의존성 없음.

---

**For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-22-navigation-cms/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

2개 이상 태스크가 참조하는 타입·상수·계약. 태스크 파일은 이 절을 가리키고 재인라인하지 않는다.

### SC-1. DB 마이그레이션 사실 (task-01)

- 마이그레이션 디렉터리: `prisma/migrations/20260622030000_navigation_fk_restrict/migration.sql`(기존 최신 `20260622000000_user_email_canonical_lowercase` 다음).
- 현재 FK(`prisma/migrations/20260617225534_init/migration.sql`):
  - `NavigationItem_parentId_fkey` → `kernel.NavigationItem(id)` `ON DELETE SET NULL ON UPDATE CASCADE`
  - `NavigationItem_requiredPermissionId_fkey` → `kernel.Permission(id)` `ON DELETE SET NULL ON UPDATE CASCADE`
- 목표: 둘 다 `ON DELETE RESTRICT ON UPDATE CASCADE`(fail-closed — D2/D8/D11). 컬럼 변경 없음, 제약 동작만.
- Prisma relation(`schema.prisma`)에 각각 `onDelete: Restrict` 명시(드리프트 방지).

### SC-2. `NavNode` — 읽기 경로 클라이언트 계약 (task-04·05)

`src/kernel/navigation/index.ts`가 export. 권한 필터는 서버에서 끝났으므로 클라이언트(`AppNav`)엔 권한 정보를 넘기지 않는다.

```ts
export interface NavNode {
  key: string;
  label: string;
  href: string | null;     // null = 링크 아님(그룹 토글). 아래 href 인코딩 규칙 참조.
  children: NavNode[];      // 2단: 부모만 children, 자식은 항상 []
}
```

**href 인코딩 규칙(D5 — link vs toggle을 데이터로 표현):** `AppNav`는 권한 정보가 없으므로 `href != null`만으로 링크/토글을 구분한다. 따라서 `selectVisibleNav`는 **부모의 `href`를 `ownAllowed(parent) ? parent.href : null`로 내려보낸다** — 자체 권한이 통과하고 원래 href가 있으면 링크, 관용으로만 노출되는(자체 권한 실패) 부모는 `href=null`(그룹 토글). 그룹 헤더(원래 href 없는 부모)도 `null`. 자식(leaf)은 항상 ownAllowed라 자기 href 유지. 이로써 `AppNav`는 `href != null → <Link>`, `href == null → 토글 버튼` 단일 규칙만 본다.

### SC-3. 권한키 계약

`resource:action` 문자열(예: `admin.navigation:view`). `permissionKey(resource, action)`(`@/kernel/access/decision`)가 단일 출처. `getPermissionSummary(userId).keys`는 `Set<string>`로 비교. UI `useCan(resource, action)` ↔ 서버 `authorize(userId, resource, action)`가 같은 키 공유(스펙 §접근제어 규칙 1).

### SC-4. `href` 검증 (D7 — task-06이 정의, task-11이 소비)

```ts
// 하드 거부: origin-relative만. 선두 // 금지(protocol-relative 외부링크 차단). 스킴·인코딩 슬래시·백슬래시·공백 자동 거부.
export const HREF_PATTERN = /^\/(?!\/)[A-Za-z0-9/_-]*$/;
// 소프트 경고용 큐레이트 내부 라우트 prefix(저장은 허용 — 페이지 선출시 등록 대비).
export const INTERNAL_ROUTE_PREFIXES = ["/dashboard", "/calendar", "/workflows", "/leave", "/admin"] as const;
```

- 통과: `/valid/path`, `/admin/navigation`. 거부: `//host`, `//evilexample`, `http://x`, `/\x`, `/a b`.
- 그룹 헤더(중메뉴 거느린 부모)는 `href` 없음(`null`) 허용.

### SC-5. `key` 생성 계약 (D17 — task-07이 정의, 다수 소비)

`NavigationItem.key`(unique)는 부트스트랩 보존·중복방지의 정체성 키. **관리자 생성 메뉴는 서버가 불변 opaque key 자동 생성, 사용자 입력·편집 불가**(가변 라벨 파생 금지). 부트스트랩 메뉴는 기존 사람-읽기 key(`dashboard`/…) 유지.

```ts
import { randomBytes } from "node:crypto";
// 라벨과 무관한 불변 opaque key. 96비트 base64url — 충돌 무시 가능(unique 제약이 최종 가드).
export function generateNavKey(): string {
  return `nav_${randomBytes(12).toString("base64url")}`;
}
```

### SC-6. 도메인 타입

입력 타입(`CreateNavInput`/`UpdateNavInput`/`ReorderNavInput`/`ReparentNavInput`)은 **task-06이 zod로 파생**(`z.infer`). `NavigationNodeAdmin`(repo 트리 반환 타입)은 **task-07이 `repositories/index.ts`에서 정의·export**(repo가 소유하는 반환 shape). services/api/ui는 거기서 import.

```ts
// 관리 트리 행(repo 조회 결과 → 서비스/UI). updatedAt = 낙관적 락 키(SC-7). (task-07)
export interface NavigationNodeAdmin {
  id: string;
  key: string;
  label: string;
  href: string | null;
  parentId: string | null;
  sortOrder: number;
  requiredPermissionId: string | null;
  isActive: boolean;
  updatedAt: Date;
  children: NavigationNodeAdmin[];
}

// 생성: key는 입력 아님(SC-5). parentId null=대메뉴.
// 수정: parentId 변경은 reparent 경로(SC-8)로 분기.
export interface CreateNavInput {
  label: string;
  href: string | null;
  parentId: string | null;
  requiredPermissionId: string | null;
  // sortOrder는 서버가 형제 말미로 부여(입력 아님).
}
export interface UpdateNavInput {
  label?: string;
  href?: string | null;
  requiredPermissionId?: string | null; // null = 공개(명시)
  isActive?: boolean;
  // parentId는 여기 없음 — 이동은 reparent 전용 경로(SC-8).
}
export interface ReorderInput {
  parentId: string | null;     // 재정렬 스코프(형제 묶음)
  orderedIds: string[];        // 새 순서의 형제 id 전체
}
export interface ReparentInput {
  id: string;
  newParentId: string | null;  // null = 대메뉴로 승격
}
```

### SC-7. 낙관적 락 (D12 — 기존 `@/kernel/optimistic` 재사용)

단일 편집·이동·삭제는 클라이언트가 본 행 버전(`updatedAt` ISO)을 함께 보낸다. 라우트 body 스키마는 `expectedUpdatedAt`(`@/kernel/optimistic`)으로 받고 `parseExpectedUpdatedAt`으로 Date 변환 후 서비스에 별도 인자로 넘긴다. repo는 `updateMany({ where: { id, updatedAt }, ... })` + `count===0` → `NavigationConflictError`. 기존 leave/users 패턴과 동형.

### SC-8. 동시성 계약 — F-6·F-7 (스펙 §13 DEFERRED high → 본 계획 task-08 AC)

reparent·cascade 삭제 트랜잭션은 `NAV_REPARENT_LOCK_NS` advisory xact lock으로 직렬화한 뒤 트랜잭션 내부에서 권위 재검증한다(leave `lockUserAndAssertNoOverlap` 패턴 동형). DB FK `parentId RESTRICT`(SC-1)가 최종 가드.

```ts
// navigation 도메인 advisory lock 네임스페이스 — 타 사용처(leave 0x6c76)와 충돌 금지.
export const NAV_REPARENT_LOCK_NS = 0x6e76; // 'nv'
```

- **F-6 (cascade reparent-away 오삭제):** 확인 시점에 `(childId, parentId, updatedAt)` 캡처 → 트랜잭션 내 advisory lock 후 **각 자식을 `parentId`+`updatedAt` CAS로 `deleteMany`**, **영향 row 합계 == 캡처 수**가 아니면 `NavigationConflictError`로 롤백(reparent-away된 자식 오삭제 방지). 이어 부모 삭제 — 늦게 들어온 자식이 있으면 `parentId RESTRICT`로 DB가 거부·롤백.
- **F-7 (동시 reparent 트리 불변식 위반):** reparent는 advisory lock 후 트랜잭션 내 **재검증**: ① 대상 부모(`newParentId`)가 여전히 top-level(`parentId == null`)인가, ② 이동 노드가 자식을 갖지 않는가(자식이 부모가 되면 depth-3), ③ 자기참조·순환 아님. 위반 시 `NavigationConflictError`. (두 유효 단일 reparent가 동시 적용돼도 lock 직렬화 + 재검증으로 하나는 거부.)

### SC-9. 에러 클래스 (task-06이 정의, api가 매핑)

`src/modules/admin/navigation/errors.ts`:

```ts
export class NavigationValidationError extends Error {
  constructor(message: string) { super(message); this.name = "NavigationValidationError"; }
}
export class NavigationConflictError extends Error {
  constructor(message = "처리 중 메뉴가 변경되었습니다. 새로고침 후 다시 시도하세요.") {
    super(message); this.name = "NavigationConflictError";
  }
}
```

API 매핑(task-10 `_shared.ts`): `ForbiddenError`→403, `NavigationValidationError`→400, `NavigationConflictError`→409, 그 외 재throw(500 삼키지 않음).

### SC-10. 권한 카탈로그 부트스트랩 (D14 — task-02)

- `RESOURCES`에 `"admin.navigation"` 추가 → `admin.navigation:view` 자동 생성(seed의 VIEW_RESOURCES 경유).
- `EXTRA_PERMISSIONS`(`prisma/seed-permissions.ts`)에 `["admin.navigation", "configure"]`.
- `ROLE_ALLOW.admin`(`prisma/seed-roles.ts`)에 `"admin.navigation:view"`, `"admin.navigation:configure"`(OWNER는 자동 전체).
- `NAV`(`catalog.ts`)는 트리로 확장 — `관리` 대메뉴에 자식 `메뉴 관리`(`href:/admin/navigation`, permission `admin.navigation:view`). `NAV`는 "초기 부트스트랩 시드 데이터(이후 DB가 진실원)"로 주석 재정의.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | FK→RESTRICT 스키마·마이그레이션 | [ ] | [task-01](2026-06-22-navigation-cms/task-01-schema-fk-restrict.md) | — | |
| 02 | 권한 카탈로그·NAV 부트스트랩 | [ ] | [task-02](2026-06-22-navigation-cms/task-02-catalog-bootstrap.md) | — | |
| 03 | seed create-if-absent(트리) | [ ] | [task-03](2026-06-22-navigation-cms/task-03-seed-navigation.md) | 02 | |
| 04 | loadNavigation 트리·관용 가시성 | [ ] | [task-04](2026-06-22-navigation-cms/task-04-load-navigation-tree.md) | — | |
| 05 | AppNav 2단 아코디언 | [ ] | [task-05](2026-06-22-navigation-cms/task-05-app-nav-accordion.md) | 04 | |
| 06 | validations·errors·href·도메인타입 | [ ] | [task-06](2026-06-22-navigation-cms/task-06-navigation-validations.md) | — | |
| 07 | repository CRUD·CAS·reorder·role-preview | [ ] | [task-07](2026-06-22-navigation-cms/task-07-navigation-repository.md) | 01,02,06 | |
| 08 | 동시성 repo: cascade(F-6)·reparent(F-7) | [ ] | [task-08](2026-06-22-navigation-cms/task-08-navigation-concurrency.md) | 07 | |
| 09 | services(게이트·audit·role-preview) | [ ] | [task-09](2026-06-22-navigation-cms/task-09-navigation-services.md) | 07,08 | |
| 10 | API 라우트(게이트·낙관락·매핑) | [ ] | [task-10](2026-06-22-navigation-cms/task-10-navigation-api.md) | 09 | |
| 11 | 관리 UI(에디터·미리보기·탭·삭제확인) | [ ] | [task-11](2026-06-22-navigation-cms/task-11-navigation-admin-ui.md) | 06,10 | |

## 실행 순서·병렬성

- 01·02·04·06은 상호 독립(병렬 가능). 03은 02 뒤, 05는 04 뒤.
- 07은 01·02·06 뒤. 08은 07 뒤(가장 적대검증·테스트가 집중되는 동시성 코어). 09→10→11 직렬.
- **F-6·F-7 인수기준은 task-08에 전용 동시성 회귀테스트로 격리**(스펙 §13 명령). task-08 AC가 곧 ledger 종결 조건.
