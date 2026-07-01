---
name: workflows-calendar-spec
description: 업무 캘린더 화면(sub-project A) spec 완료·review-loop 5R·수준 B 확정 — plan 단계는 새 세션에서
metadata: 
  node_type: memory
  type: project
  originSessionId: 994647f2-569b-4257-b82a-fd9176533351
---

`feat/workflows-calendar` 브랜치(origin/main=98c1d9a에서 분기). sub-project **A(업무 캘린더 화면)** = 사용자 4요청 중 1·2·3(메뉴명·캘린더뷰·날짜클릭 생성). 4(재사용 수신자 to/참조/숨은참조 세트)는 **sub-project B 별도 spec**로 다음.

**spec**: `docs/specs/2026-07-01-workflows-calendar-design.md` (D1~D13 + §8 ledger). brainstorming 승인 후 **spec 단계 review-loop 5회(=max)** 완료, 미판정 blocking 0.

핵심 설계:
- `/workflows` 목록 → `CalendarMonth`(연차 캘린더와 동일 컴포넌트) 재사용 월 캘린더. 단일선택 6필터. kind별 5색(kind-styles additive). CANCELLED만 취소선.
- 신규 kind 2종 enum 추가(`WEEKLY_REPORT_CLIENT`·`MONTHLY_REPORT_CLIENT`, additive 마이그레이션) + `KIND_RESOURCE`/`TRANSITIONS`/`KIND_LABEL`/`WorkflowType` seed/권한.
- 날짜 클릭 팝오버(그날 작업+새작업등록) + "+"; 생성 모달 일반화(작업유형 드롭다운).
- 네비 "업무 목록"→"캘린더"(D11), nav 게이팅을 집계 `workflows:view`로(D13, 민원 외주 등 실재 배제 defect 해소).

**사용자 결정(재논의 말 것)**:
- **수준 B**: 5종 모두 **예약(PENDING) 생성 가능**(문서 생성은 생성기 있는 대금청구만). client kind도 create 부여. 드롭다운=5종(Q2의 3종에서 확장). R4·F1(OWNER 생성 가능→rollback 노출)은 **ACCEPTED**(rollback preflight로 관리, 예약 편의 우선).
- nav 게이팅 수정=이번 스코프 포함(사용자 승인).

**DEFERRED_TO_IMPL(plan AC로)**: ① 서버 range 강제 메커니즘(기존 `/api/workflows` GET 검증 추가 vs 전용 `/api/workflows/calendar` 신설) — half-open exclusive end + 빈/역순/과대 span 거부, ② `workflows:view` upgrade-once reconcile 스크립트(기존 role, billing-ui migrate-helpers 패턴, nav flip 전 실행), ③ 조회 `ALL_KINDS`를 `Object.keys(KIND_RESOURCE)`로 단일화.

**다음**: plan 단계 = 단계 경계 → **새 세션에서 `dev-workflow:writing-plans-split`**로 작성. 실행은 `superpowers:subagent-driven-development`. 표현계층+additive 스키마=표준 restart 배포. 관련: [[session-per-merge-workflow]] [[backend-minimal-data-principle]]
