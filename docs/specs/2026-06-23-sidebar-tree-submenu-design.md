# 사이드바 트리 중메뉴 일원화 (설계 spec)

> 작성일 2026-06-23 · 상태: 설계 확정(brainstorming 완료, 사용자 결정 반영) · 후속: `writing-plans-split` → 구현
> 계보: 메뉴 관리(Navigation CMS) 스펙(2026-06-22)로 사이드바가 **2단 트리**로 바뀜. 본 스펙은 아직 **본문 상단 탭/랜딩 링크로 흩어진 중메뉴**를 그 트리로 옮겨 일관성을 맞춘다.

## 1. 배경과 목적

Navigation CMS(2026-06-22) 이후 사이드바는 `loadNavigation`/`AppNav`로 **2단 트리(대메뉴 + 중메뉴 아코디언)**를 렌더한다(`관리 > 메뉴 관리`가 그 예). 그러나 **연차 중메뉴**는 여전히 본문 상단 `LeaveTabs`(7개 탭)로만 존재하고, **관리 중메뉴**는 `/admin` 랜딩의 작은 `AdminLinks` 목록(+ 사이드바엔 메뉴 관리 1개)으로만 노출된다. 즉 탐색 경로가 **두 가지 패러다임(좌측 트리 vs 본문 상단 탭)**으로 갈려 일관성이 없다.

본 스펙은 **연차·관리의 중메뉴를 좌측 사이드바 트리의 자식으로 일원화**한다. 연차 관리 기능(승인/할당/현황 — PM/OWNER 전용)은 트리를 비대하게 만들지 않도록 **단일 트리 항목 "연차 관리" 1개 + 그 페이지 내부 탭**으로 묶는다.

이미 존재하는 기반(재사용 대상):

- 렌더: `src/app/(app)/app-nav.tsx`(`AppNav`/`computeNavRows`/`isActiveHref` — 이미 2단 자식 렌더 지원), `src/kernel/navigation/index.ts`(`loadNavigation`/`selectVisibleNav` — 관용 가시성 D4/D5)
- 메뉴 데이터: `src/kernel/access/catalog.ts`의 `NAV`(부트스트랩 시드), `prisma/seed.ts` + `prisma/seed-navigation.ts`(create-if-absent, D3)
- 권한: `src/kernel/access/*`(`requirePermission`/`getPermissionSummary`), UI `useCan`, 권한 카탈로그(`RESOURCES`/`ACTIONS`)·역할 매트릭스(`seed-roles.ts`)
- 기존 중메뉴: `src/app/(app)/leave/_components/leave-tabs.tsx`(권한별 탭 매핑), `src/app/(app)/admin/admin-links.tsx`
- 연차 관리 페이지: `src/app/(app)/leave/{approvals,allocations,status}/`

## 2. 범위

### 포함 (IN)

- `NAV` 카탈로그에 **연차 5자식 + 관리 1자식(사용자 관리)** 추가 → 재시드로 트리 노출
- **연차 관리**를 단일 트리 항목 `/leave/manage`로 묶고, 그 아래 **페이지 내 탭**(승인/할당/현황) 제공
- 기존 `/leave/{approvals,allocations,status}` 3개 페이지를 **`/leave/manage/` 하위로 이동**(공통 prefix로 사이드바 활성 표시 유지)
- 사이드바 **active 판정 정밀화**(형제 중 가장 구체적인 href만 active)
- 흩어진 중메뉴 제거: 본문 상단 `LeaveTabs` 삭제, `/admin` 랜딩 `AdminLinks` 정리

### 제외 (OUT)

- 3단 이상 트리(D6 2단 제한 유지 — Navigation CMS 스펙)
- 새 `Permission`·권한 카탈로그/역할 매트릭스 변경(기존 권한 **재사용만**)
- 업무·캘린더 영역(중메뉴 없음 — 변경 없음)
- 메뉴 데이터를 마이그레이션/스크립트로 강제 주입(시드 create-if-absent로 충분 — D3)

## 3. 결정 기록 (Decisions)

> codex 적대검증은 아래 결정과 상위 Navigation CMS 스펙(D3~D6)을 모른다. finding이 이 결정과 충돌하면 버그가 아니라 의도된 설계다 — 고치기 전 대조할 것.

| # | 결정 |
| --- | --- |
| **D1** | **중메뉴를 좌측 트리로 일원화.** 본문 상단 탭(`LeaveTabs`)·`/admin` 랜딩 링크(`AdminLinks`)는 트리와 중복 → 제거. 모든 중메뉴 탐색은 사이드바 트리로 단일화. |
| **D2** | **데이터 = `NAV` 카탈로그 + 재시드(create-if-absent).** 새 컬럼·마이그레이션·스크립트 없음. 메뉴 SSOT는 DB(상위 스펙 D3) — 코드 `NAV`는 부트스트랩일 뿐, 재시드 시 **신규 자식만** 추가되고 기존 편집은 보존. |
| **D3** | **연차 트리 = 5자식**(부모 `연차`→`/leave`, `leave.request:view`): ① 대시보드 `/leave` `leave.request:view` ② 연차 신청 `/leave/request` `leave.request:create` ③ 캘린더 `/leave/calendar` `leave.request:view` ④ 연차 내역 `/leave/history` `leave.request:view` ⑤ 연차 관리 `/leave/manage` `leave.approval:view`. 권한은 기존 `LeaveTabs` 매핑 계승. |
| **D4** | **연차 관리 = 단일 트리 leaf + 페이지 내 탭.** 트리엔 `연차 관리` 1개만(`/leave/manage`, gate `leave.approval:view`). 그 페이지 상단 탭바(`ManageTabs`)로 승인/할당/현황 전환 — **탭은 트리 미포함**. 관리 기능 3종은 PM/OWNER 전용이라 트리 비대화 방지. |
| **D5** | **라우트 이동: `/leave/{approvals,allocations,status}` → `/leave/manage/{(index=approvals),allocations,status}`.** 사유: 트리 항목 `연차 관리`가 3개 탭 페이지 **모두에서 활성 표시**되려면 공통 prefix(`/leave/manage`)가 필요(현 위치 유지 시 할당/현황에서 강조 끊김). `(manage)` 세그먼트 레이아웃이 `ManageTabs`를 렌더. **승인 = 인덱스**(`/leave/manage` = `page.tsx`), 할당 = `/leave/manage/allocations`, 현황 = `/leave/manage/status`. 페이지별 서버 권한 가드(`leave.approval/allocation/status:view`)는 그대로 따라 이동. |
| **D6** | **관리 트리 = 2자식**(부모 `관리`→`/admin`, `admin.users:view`): ① 사용자 관리 `/admin/users` `admin.users:view`(신규) ② 메뉴 관리 `/admin/navigation` `admin.navigation:view`(기존). |
| **D7** | **상위 클릭 = 링크 + 펼침(현행 유지).** 자식 있는 부모(연차/관리)는 자체 권한 통과 시 링크로 동작(상위 스펙 D5 그대로). 연차 부모(`/leave`)와 자식 `대시보드`(`/leave`)의 href 중복은 **의도적 허용**(사용자가 `대시보드`를 명시 항목으로 요청). nav 로직(`selectVisibleNav`) 변경 없음. |
| **D8** | **active 판정 정밀화(`computeNavRows`).** 한 부모의 **자식들 중 현재 경로와 매칭되는 가장 긴(구체적) href 1개만** `active`. 부모 자체 강조는 기존 prefix 매칭 유지(섹션 하이라이트·자동 펼침). 예: `/leave/request`→`연차 신청`만(대시보드 아님), `/leave/manage/allocations`→`연차 관리`. 순수 함수 변경 → TDD(테스트 먼저). `ManageTabs`의 인덱스 탭(승인=`/leave/manage`)도 동일하게 **인덱스 정확매칭** 적용. |
| **D9** | **권한 키 공유(노출=실행).** 트리 항목·페이지·탭이 동일 permission 키 사용(UI `useCan` = 서버 `requirePermission` — 접근제어 규칙 1). `연차 관리` 트리 gate = `leave.approval:view`(= 기본 탭 승인). 탭별 노출은 각 권한(`leave.approval/allocation/status:view`)으로 `useCan` 개별 판정(현 `LeaveTabs` 패턴 계승). |
| **D10** | **sortOrder.** 신선 설치는 정상(연차 자식 10~50, 관리 사용자=10·메뉴=20). 기존 dev DB는 ① 연차 자식 0개 → 5개 깨끗이 신규 생성, ② 관리는 기존 `메뉴 관리`가 sortOrder 10 점유 → 신규 `사용자 관리`도 10이라 **동률 가능**(순서 비결정적). 시드는 기존 sortOrder를 **덮지 않음**(D3) → dev DB는 CMS ↑/↓로 1회 정렬 또는 신선 재시드로 해소. 본 동작은 회귀가 아니라 D3의 결과. |
| **D11** | **중복 제거 범위.** ① `leave/layout.tsx`에서 `<LeaveTabs/>` 제거(상위 `<h1>연차</h1>`·섹션 래퍼 유지) ② `leave-tabs.tsx` 삭제(타 import 없음 확인) ③ `/admin` 랜딩의 `AdminLinks` 정리(최소 랜딩 유지 — 부모 `관리`가 `/admin` 링크이므로 페이지는 존속) ④ `ManageTabs` 신규(승인/할당/현황). |

## 4. 트리 구조 (결과)

```
대시보드            /dashboard
캘린더              /calendar
업무                /workflows
연차                /leave                     (leave.request:view)
  ├ 대시보드        /leave                     (leave.request:view)
  ├ 연차 신청       /leave/request             (leave.request:create)
  ├ 캘린더          /leave/calendar            (leave.request:view)
  ├ 연차 내역       /leave/history             (leave.request:view)
  └ 연차 관리       /leave/manage              (leave.approval:view)
관리                /admin                     (admin.users:view)
  ├ 사용자 관리     /admin/users               (admin.users:view)
  └ 메뉴 관리       /admin/navigation          (admin.navigation:view)
```

연차 관리 페이지 내부 탭(트리 아님):

```
연차 관리 페이지 (/leave/manage)
  [연차 승인]  /leave/manage              (leave.approval:view)   ← 인덱스
  [연차 할당]  /leave/manage/allocations  (leave.allocation:view)
  [연차 현황]  /leave/manage/status       (leave.status:view)
```

## 5. 변경 대상 (Components)

| 파일 | 변경 |
| --- | --- |
| `src/kernel/access/catalog.ts` | `NAV`의 `leave`에 자식 5개 추가, `admin`에 `사용자 관리` 자식 추가(메뉴 관리 앞·뒤 순서는 D6대로 사용자=먼저). |
| `src/app/(app)/app-nav.tsx` | `computeNavRows` active 판정에 "형제 최장 매칭 우선" 규칙 추가(D8). 부모 prefix 강조는 유지. |
| `src/app/(app)/leave/layout.tsx` | `<LeaveTabs/>` 제거(h1·래퍼 유지). |
| `src/app/(app)/leave/_components/leave-tabs.tsx` | **삭제**(미사용). |
| `src/app/(app)/leave/manage/layout.tsx` | **신규** — `ManageTabs` + children. |
| `src/app/(app)/leave/manage/_components/manage-tabs.tsx` | **신규** — 승인/할당/현황 탭(권한별 `useCan`, 인덱스 정확매칭). |
| `src/app/(app)/leave/manage/page.tsx` (+ `allocations/`, `status/`) | 기존 `approvals/allocations/status`에서 **이동**(서버 가드 동반). 승인=인덱스. |
| `src/app/(app)/leave/{approvals,allocations,status}/` | 이동 후 **제거**. |
| `src/app/(app)/admin/page.tsx`, `admin-links.tsx` | `AdminLinks` 정리(최소 랜딩 유지/`admin-links.tsx`는 미사용 시 삭제). |

라우트 이동 시 **이전 경로 참조를 전수 갱신**한다(예: 코드 내 하드링크·테스트의 페이지 경로 import). API 라우트(`/api/admin/leave/*`)는 페이지와 분리되어 **이동 대상 아님**.

## 6. 테스트 (TDD)

- `tests/app/nav/compute-nav-rows.test.ts` — D8 추가 케이스: `/leave`→대시보드만, `/leave/request`→연차신청만(대시보드 비활성), `/leave/manage/allocations`→연차관리 active, 부모 `연차` 모든 `/leave/*`에서 강조.
- `ManageTabs` — 인덱스 탭(승인) `/leave/manage` 정확매칭, 권한 없는 탭 미노출.
- `tests/prisma/seed-navigation.test.ts` — 기존 부모(`leave`/`admin`)에 신규 자식만 추가, 기존 자식 보존(create-if-absent 재귀) 회귀 확인.
- 라우트 이동 후 관련 페이지/테스트 경로 참조 갱신, **`npm run lint`/`typecheck`/`test`/`build` 그린**.

## 7. 수용 기준 (Acceptance Criteria)

1. 재시드 후 사이드바에서 `연차`를 펼치면 대시보드/연차 신청/캘린더/연차 내역/연차 관리가 보이고, `관리`를 펼치면 사용자 관리/메뉴 관리가 보인다(권한 보유 한도 내).
2. 본문 상단 연차 탭이 더는 보이지 않는다(`LeaveTabs` 제거).
3. `/leave/manage`로 진입하면 승인/할당/현황 탭바가 보이고, 어느 탭에 있든 사이드바 `연차 관리`가 활성으로 강조된다.
4. `/leave/request`에서 사이드바 `연차 신청`만 활성(대시보드 비활성), `/leave`에서 `대시보드`만 활성.
5. 권한이 없는 사용자에겐 해당 트리 항목·탭이 노출되지 않으며, 서버 가드도 동일 키로 차단(노출=실행).
6. `lint`/`typecheck`/`test`/`build` 모두 그린.
