---
name: workflows-calendar-spec
description: 업무 캘린더 화면(sub-project A) spec+plan+SDD 구현+impl review-loop 5회(=max) 종결 → **PR #30 머지(merge commit acd1d48)+kgs-dev 배포 완료**(2026-07-02). D5=전용 라우트, WorkflowType prod갭, SC-13 통일, 이력목록 토글 복구. 다음=sub-project B(수신자 세트)
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

**SDD 구현 완료(2026-07-01, HEAD=2b6702f, impl 8커밋 de2484a..2b6702f)**: task-01~07 전부 task리뷰 Approved(Critical/Important 0), 최종 whole-branch 리뷰(opus)=**Ready to merge YES**. 게이트: typecheck/lint clean(rules-of-hooks 0)·test 1694 passed(1 사전존재 env 실패=list-with-user 무관)·build green(`/api/workflows/calendar` ƒ 등록). 최종리뷰 Minor 1 fix(2b6702f, test-only)=labels.test에 WORKFLOW_KIND_ORDER 완전성 가드(F1 마지막 손수유지 배열 drift 방지). no-AI-trace grep clean. 브랜치 그대로 유지(사용자 선택). SDD 원장=`.superpowers/sdd/progress.md`(git-ignored).
- **배포=표준 restart**(task-01 additive enum migration 동반): prisma migrate deploy → generate → db:seed[**grant→seedNavigation→nav flip 순서**·WorkflowType 5종] → build → pm2 restart. smoke: /workflows 캘린더·생성모달·/api/workflows/calendar 200(인증)·**notification-only role(민원 외주) 메뉴 노출**(기존설치 검증, fresh seed만으론 불충분).

**impl review-loop 완료(2026-07-02, 5회=max, base=98c1d9a, HEAD=8a6f246, 미판정 blocking 0)** — 5커밋(9bd192f·7523f89·d36aab9·344b1c8·8a6f246). 각 라운드 distinct 심화(churn 아님), 게이트 green(test 1713·build). ledger=spec §9. **사용자 판정(재논의 말 것)**:
- **R1 medium→FIXED(사용자 결정=이력목록 복구)**: 캘린더 완전교체로 운영창(±12개월) 밖 과거/미래 task UI 발견 불가(감사·재다운로드). **캘린더/목록 토글** 추가(`workflows-view.tsx`), 목록은 range 없이 `GET /api/workflows`로 전체 이력(복구 `workflows-list.tsx`, 브라우징 전용·생성은 캘린더 모달 단일출처). page title "업무 캘린더"→"업무".
- **R2 medium→FIXED**: `applyWorkflowsViewUpgrade`가 role만 승격, kind-view를 scope=all ALLOW override로만 가진 사용자 누락 → 집계 override 승격 추가(접근제어 규칙①).
- **R3 high→FIXED**: 기존 DB에 신규 client kind view/create 미배포(bootstrap 스킵) → **`applyWorkflowsClientKindsUpgrade` 신설**(client :view=weekly:view 보유 role, :create=pm, billing-create 선례). §7 3b, nav flip 전.
- **R4-A high→FIXED**: 위 헬퍼 driver가 scope·DENY 무관 → scope=all ALLOW ∧ role DENY 제외로 한정(getPermissionSummary 일치).
- **R4-B medium→DUPLICATE/ACCEPTED**: enum rollback version-skew=spec R4·#8 기결정.
- **R5 high→ACCEPTED(사용자 결정+§7 preflight)**: client :view 승격이 user weekly:view DENY override 미mirror(targeted deny 우회). 근거=D5 비민감·신규 empty·드문 시나리오·타 helper도 미mirror. 배포 preflight로 weekly:view DENY override 보유자 점검.

**PR #30 머지+배포 완료(2026-07-02)**: merge commit `acd1d48`(main), origin=local 일치 확인 후 `gh api` REST merge. **kgs-dev 배포 완료**(표준 restart): git pull(98c1d9a→acd1d48) → prisma:generate(스키마 변경) → migrate deploy(`20260701000000_workflow_client_kinds` additive enum +2 적용) → db:seed(permissions=55·roles=6·nav=5, grant→seedNav→flip) → db:seed:demo → build(`/api/workflows/calendar` ƒ 등록) → pm2 restart(online). **DB 검증**: WorkflowKind enum에 WEEKLY_REPORT_CLIENT·MONTHLY_REPORT_CLIENT 반영·`workflows.weeklyClient|monthlyClient:view/create` 권한 등록·**R3 reconcile 반영**(weeklyClient:view→관리자·PM / :create→PM). **R5 preflight**: workflows `*:view` DENY override 보유자 0명 → R5 우려 이 환경 무해. **HTTP smoke green**: /login 200·/api/workflows/calendar 401·/api/calendar/feed 401(advisory·P2010 없음)·/api/leave/calendar 401. pm2 err log는 어제(07-01) billing STORAGE_ROOT 흔적뿐(조치 완료·재시작 후 신규 에러 0). 잔여=인증 후 시각 smoke(LAN 172.21.10.27:3200 수동). 관련: [[session-per-merge-workflow]] [[backend-minimal-data-principle]] [[billing-generation-storage-root-deploy-gap]] [[no-ai-trace-in-review-loop-output]] [[workflows-billing-ui-review-loop]]
