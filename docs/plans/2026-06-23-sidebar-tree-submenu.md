# 사이드바 트리 중메뉴 일원화 — 구현 계획 (entrypoint)

- **Goal:** 연차·관리의 중메뉴를 좌측 사이드바 트리의 자식으로 일원화하고, 연차 관리(승인/할당/현황)는 `/leave/manage` 단일 항목 + 페이지 내 탭으로 묶는다.
- **Architecture:** 메뉴 데이터는 `NAV` 카탈로그 부트스트랩 + 재시드(create-if-absent, SSOT=DB). 사이드바 렌더는 기존 `loadNavigation`/`AppNav` 2단 트리 재사용. 본문 상단 탭(`LeaveTabs`)·`/admin` 랜딩 링크(`AdminLinks`) 제거. active 판정만 "형제 최장 매칭 우선"으로 정밀화.
- **Tech Stack:** Next.js App Router, TypeScript, Prisma(PostgreSQL), vitest. 새 마이그레이션·권한 변경 없음.
- **Spec:** `docs/specs/2026-06-23-sidebar-tree-submenu-design.md` (결정 D1~D11).

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-23-sidebar-tree-submenu/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | NAV 카탈로그 트리 확장 + 구조 테스트 | [ ] | [task-01](2026-06-23-sidebar-tree-submenu/task-01-nav-catalog.md) | — | |
| 02 | app-nav active 판정 정밀화(형제 최장 매칭) | [ ] | [task-02](2026-06-23-sidebar-tree-submenu/task-02-active-precedence.md) | — | |
| 03 | 연차 관리 라우트 이동 + ManageTabs + LeaveTabs 제거 | [ ] | [task-03](2026-06-23-sidebar-tree-submenu/task-03-leave-manage-restructure.md) | — | |
| 04 | 관리 랜딩 정리(AdminLinks 제거) | [ ] | [task-04](2026-06-23-sidebar-tree-submenu/task-04-admin-landing-cleanup.md) | — | |

권장 실행 순서: 01 → 02 → 03 → 04. 태스크 간 강한 의존은 없으나(각 태스크가 lint/typecheck/build/test 그린을 유지), 03 이후 04를 두면 admin 정리가 마지막에 깔끔히 닫힌다.

## Shared Contracts

엔트리포인트는 모든 태스크와 함께 읽힌다 — 공유 계약은 여기 한 번만 둔다.

### C1. `NavEntry` 타입 (기존, `src/kernel/access/catalog.ts`)

```ts
export interface NavEntry {
  key: string;
  label: string;
  href: string;
  permission: string; // "resource:action"
  children?: readonly NavEntry[]; // 2단 부트스트랩 자식(이후 DB가 진실원 — 상위 스펙 D3)
}
```

### C2. `NAV` 최종 형태 (task-01의 결과 — 이 배열 그대로)

```ts
export const NAV: readonly NavEntry[] = [
  { key: "dashboard", label: "대시보드", href: "/dashboard", permission: "dashboard:view" },
  { key: "calendar", label: "캘린더", href: "/calendar", permission: "calendar.work:view" },
  { key: "workflows", label: "업무", href: "/workflows", permission: "workflows.weekly:view" },
  {
    key: "leave", label: "연차", href: "/leave", permission: "leave.request:view",
    children: [
      { key: "leave-dashboard", label: "대시보드", href: "/leave", permission: "leave.request:view" },
      { key: "leave-request", label: "연차 신청", href: "/leave/request", permission: "leave.request:create" },
      { key: "leave-calendar", label: "캘린더", href: "/leave/calendar", permission: "leave.request:view" },
      { key: "leave-history", label: "연차 내역", href: "/leave/history", permission: "leave.request:view" },
      { key: "leave-manage", label: "연차 관리", href: "/leave/manage", permission: "leave.approval:view" },
    ],
  },
  {
    key: "admin", label: "관리", href: "/admin", permission: "admin.users:view",
    children: [
      { key: "admin-users", label: "사용자 관리", href: "/admin/users", permission: "admin.users:view" },
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
    ],
  },
] as const;
```

키 규약: 기존 부트스트랩 key(`dashboard`/`calendar`/`workflows`/`leave`/`admin`/`admin-navigation`)는 **그대로 보존**(재시드 시 skip → 편집 보존). 신규 자식 key는 `leave-*`, `admin-users`. 모든 permission 키는 기존 카탈로그(`RESOURCES`×`ACTIONS`)에 이미 존재 — **새 권한 없음**.

### C3. `computeNavRows` active 판정 규칙 (task-02)

`src/app/(app)/app-nav.tsx`의 순수 함수. 변경점 한 가지: **한 부모의 자식들 중 현재 경로와 매칭되는 가장 긴(구체적) href 1개만** `active`. 부모 자체(`row.active`/`autoExpanded`)는 기존 `isActiveHref` prefix 매칭 유지. `isActiveHref(href, pathname)` 시그니처·동작은 **불변**(`pathname === href || pathname.startsWith(href + "/")`, null→false).

기대 동작:
- `/leave` → 자식 `대시보드`(`/leave`)만 active
- `/leave/request` → `연차 신청`만 active (`대시보드` 아님)
- `/leave/manage/allocations` → `연차 관리`(`/leave/manage`) active, 부모 `연차` 강조·펼침

### C4. 연차 관리 라우트 이동 매핑 (task-03)

| 이동 전 | 이동 후 | 비고 |
| --- | --- | --- |
| `src/app/(app)/leave/approvals/page.tsx` | `src/app/(app)/leave/manage/page.tsx` | 승인 = `/leave/manage` 인덱스 |
| `src/app/(app)/leave/approvals/approvals-client.tsx` | `src/app/(app)/leave/manage/approvals-client.tsx` | import는 모두 `@/` 절대경로 → 무변경 |
| `src/app/(app)/leave/allocations/` (폴더) | `src/app/(app)/leave/manage/allocations/` | page + allocations-client 동반 |
| `src/app/(app)/leave/status/` (폴더) | `src/app/(app)/leave/manage/status/` | page만(아래 import 수정) |

- `status/page.tsx`의 `import { StatusClient } from "../_components/status-client";` → **`"../../_components/status-client"`**(한 단계 깊어짐). `status-client.tsx`는 `leave/_components/`에 **그대로 둔다**(이동 안 함).
- client들은 모두 `/api/admin/leave/*` API만 fetch(페이지 라우트 미참조) → fetch URL **무변경**.
- API 라우트(`src/app/api/admin/leave/*`)는 페이지와 분리 → **이동 대상 아님**.

### C5. `ManageTabs` 탭 정의 (task-03, 신규 컴포넌트)

```ts
const TABS = [
  { href: "/leave/manage",             label: "연차 승인", resource: "leave.approval",   action: "view" },
  { href: "/leave/manage/allocations", label: "연차 할당", resource: "leave.allocation", action: "view" },
  { href: "/leave/manage/status",      label: "연차 현황", resource: "leave.status",     action: "view" },
];
```

active 판정: 인덱스 탭(승인=`/leave/manage`)은 **정확 일치**(`pathname === "/leave/manage"`), 나머지는 `pathname.startsWith(tab.href)`. 탭별 노출은 `useCan(resource, action)`(현 `LeaveTabs` 패턴 계승 — 노출=실행).

### C6. 검증 명령(모든 태스크 공통 AC)

```
npm run typecheck     # tsc --noEmit, 에러 0
npm run lint          # eslint src(boundaries 포함), 에러 0
npm test              # vitest run, 전부 통과
npm run build         # 프로덕션 빌드 성공(라우트 트리 변동 반영)
```

DB 없이 위 4개 모두 동작. 재시드(`npm run db:seed`)는 dev 배포 절차에서 수행(코드 변경엔 불필요).

## 적대검증 판정 (review-loop R1, plan phase)

codex 적대검증(`--base main`) 1라운드 — finding 3건 모두 **ACCEPTED**로 판정해 닫음(미판정 blocking 0). codex는 spec 결정(D1~D11)·역할 매트릭스·재시드 동작을 모르므로 의도된 설계를 재지목한 항목 포함.

| # | finding (sev) | 판정 | 근거 |
| --- | --- | --- | --- |
| F1 | nav가 구 UI 제거 후 재시드에 의존 (high) | ACCEPTED | `seedNavigation`이 **기존 부모에도 자식 재귀를 돌아**(`prisma/seed-navigation.ts:20,56-58`) 재시드 시 신규 5자식을 정확히 추가 — 메커니즘 우려는 오탐. spec D2+OUT이 마이그레이션 대신 시드 create-if-absent를 의도적으로 결정. §6에 재귀 회귀 테스트 계획됨. **보완:** 아래 배포 순서 노트. |
| F2 | 구 leave 관리 URL을 redirect 없이 제거 (high) | ACCEPTED | 사용자 결정(R1): 컷오버 전 내부 dev/test 앱 — 외부 북마크 표면 없음, 해당 라우트는 Phase 5에서 최근 추가, 탐색은 사이드바 트리(새 URL로 갱신). 컷오버 대상 annual-leave는 별도 URL이라 이전 북마크 이슈 없음. spec D5가 이동을 의도적으로 결정 + Simplicity-first → redirect shim 미추가. |
| F3 | 단일 `leave.approval:view` 게이트가 allocation/status-only 접근 숨김 (medium) | ACCEPTED | spec D4/D9가 "관리 3종 = PM/OWNER 전용" 단순화를 의도적으로 결정. `ROLE_ALLOW`에서 세 권한은 `pm:["*"]`·OWNER만 받고 **항상 함께** 부여(`prisma/seed-roles.ts`) — 부분 보유는 수동 override로만 가능한 희귀 케이스. 페이지는 각 권한으로 서버 가드 유지(노출=실행)라 보안 무해, nav 발견성 갭일 뿐. **재검토 트리거:** 부분 override가 실제 운영 패턴이 되면 트리 게이트를 3권한 OR로 재고. |

### 배포 순서 노트 (F1 보완)

`/leave/manage/*` 트리 노출은 **재시드(`npm run db:seed`)에 의존**한다. task-03/04가 fallback nav(`LeaveTabs`/`AdminLinks`)를 제거하므로, **배포 시 코드 반영과 재시드를 함께** 수행해야 사이드바 회귀(이동 페이지 미발견)가 없다. dev 배포 절차(CLAUDE.md)에 `npm run db:seed`가 이미 포함됨 — 누락 금지. (신선 설치는 무관, 기존 dev DB는 연차 자식 0→5 신규 생성.)
