---
name: workflows-calendar-spec
description: 업무 캘린더 화면(sub-project A) spec+split plan+plan review-loop 완료(7태스크) — 구현(SDD)은 새 세션에서. D5=전용 라우트, WorkflowType prod갭 확정, SC-13 에러상태 통일
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

**DEFERRED_TO_IMPL — plan에서 확정(재논의 말 것)**:
- ① 서버 range 메커니즘 = **전용 `GET /api/workflows/calendar` 신설**(연차 패턴). 기존 `GET /api/workflows`는 불변(routes.test 보존). 서비스 `getCalendarTasks(ctx,{start:Date,end:Date})` 비-optional=타입 강제 range. 라우트가 누락·빈·역순·span>46일·운영창(±13개월) 밖 → 400. 클라는 `end=winEnd`(exclusive) 전송(half-open, `scheduledAt<end`가 마지막 셀 포함).
- ② `applyWorkflowsViewUpgrade`(dynamic, 임의 kind view role reconcile) + `applyWorkflowsNavReconcile`(nav flip) 헬퍼 2종, seed 순서=grant→seedNavigation→flip.
- ③ `ALL_KINDS`·page `KINDS` = `Object.keys(KIND_RESOURCE)` 단일화.

**plan 작성 중 발견(중요)**: 메인 `seed.ts`엔 `BILLING` WorkflowType만 있고 `WEEKLY_REPORT`/`NOTIFICATION_BILLING`은 **seed-demo(dev 전용)**에만 존재 → 일반화 모달이 offer하는 create가 prod에서 403. **task-06이 메인 seed에 생성가능 4종(weekly/notification/client 2종) WorkflowType upsert 추가**로 갭 폐쇄(placeholder templatePath).

**split plan**: `docs/plans/2026-07-01-workflows-calendar.md`(엔트리포인트 §Shared Contracts SC-1~13 + §Plan 적대검증 ledger) + `2026-07-01-workflows-calendar/task-01~07`. 01 도메인 스캐폴딩→02 UI색·라벨·어댑터→03 캘린더 조회 라우트·서비스→04 생성 모달→05 캘린더 화면+page교체+list제거→06 시드·권한·nav배포→**07 기존 leave-calendar 에러상태 통일**. 회귀 테스트 R1(조회커버리지·fetch URL)·R2(생성게이트)·R3(nav 가시성)·R4(exclusive end 경계) 포함.

**plan 단계 review-loop 완료(3회, approve 종결, 미판정 blocking 0)** — ledger:
- **FIXED**: task-05 `canCreateAny`가 `useCan()||useCan()` OR 체인이라 short-circuit으로 hook 호출 수 가변=Rules of Hooks 위반+lint 실패 → 5종 각각 const 무조건 호출 후 boolean OR로 교정(task-04는 Record 리터럴이라 원래 안전).
- **FIXED(사용자 결정=전 캘린더 통일)**: 캘린더 조회 실패를 `data?.x ?? []`로 조용히 빈 화면 위장(silent failure). **SC-13** 신설(정본=`calendar-view.tsx` line 125 `{isError && …}`) → task-05 workflows-calendar + **task-07 신규**로 leave-calendar에 `isError` 배너 적용. calendar-view는 이미 준수(무변경).
- **DUPLICATE**: rollback version-skew(신규 enum) 재지적 = spec R4·F1 ACCEPTED(수준 B, allow-list 차단 미채택, 수동 preflight+단일 pm2+cutover 2-phase 관리). **재수정 말 것**.
- no-AI-trace 정리 커밋(도구명 제거, spec 176행 포함).

**다음**: 단계 경계 → **새 세션에서 `superpowers:subagent-driven-development`**로 구현(01부터, 01 이후 02·03·06·07 병렬 가능→04→05). 표현계층+additive 스키마=표준 restart 배포. 관련: [[session-per-merge-workflow]] [[backend-minimal-data-principle]] [[billing-generation-storage-root-deploy-gap]] [[no-ai-trace-in-review-loop-output]]
