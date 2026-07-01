---
name: leave-calendar-job-filter-pr
description: 연차 캘린더 직무 필터+범례 통일+공휴일 표시 SDD 6태스크 → PR #27 머지(5991365)+kgs-dev 배포 완료; 서버측 직무필터·jobFunction 미노출·공휴일 read-only+신호·D10 윈도우+경계 fix; 수용 결정(재논의 말 것)
metadata: 
  node_type: memory
  type: project
  originSessionId: d9788f03-ce7f-4010-84cb-b1a15ad1833f
---

연차 캘린더(`/leave/calendar` → `LeaveCalendar`) 직무 필터 + 변형 A 범례 통일 + 공휴일 표시 + nav 우측. SDD 6태스크(각 spec/quality 리뷰 Approved) + opus whole-branch(Ready-to-merge) + review-loop(codex 3 iteration) 완료 → **PR #27 머지(merge commit 5991365)+kgs-dev 배포 완료**(2026-06-26, feat/leave-calendar-job-filter, 구현 HEAD e6929d6). spec=`docs/specs/2026-06-26-leave-calendar-job-filter-design.md`(D1~D10). 표현계층+조회경로만 → **무마이그레이션·표준 restart 배포**(pull→prisma:generate→build→pm2 restart, db:seed/migrate 불필요). test 1445green·no-AI-trace. 배포 smoke: /login 200·/api/leave/calendar 401·/api/calendar/feed 401(라우트 로드·P2010 크래시 없음). 잔여=인증 후 시각 smoke(LAN 172.21.10.27:3200, NEXTAUTH_URL=LAN).

핵심 설계: 직무 필터=**서버측**(getLeaveCalendar가 권한스코프 × 직무 ACTIVE userId 집합 AND 교집합), **jobFunction 응답/LeaveCalendarEvent 미노출**(데이터 최소화 [[backend-minimal-data-principle]]). 공휴일=**read-only**(getHolidayEventsInRange, sync 트리거 없음)+`{events,holidays,unsyncedYears}` 응답, 미적재·실패는 unsyncedYears 신호. D10 윈도우 검증(start≤end·≤46일·now±12개월).

**수용 결정(재논의 말 것):**
- **조회 운영창 +1개월 여유(Option A)**: 그리드 spillover 수용 위해 끝점 검증=MAX_ANCHOR_MONTHS+1(13). 직접 API로 ±13개월 가능하나 권한 내 데이터·폭 46일 cap이 enumeration 담당이라 수용. codex가 3회(R1-1→R2-1→R3-1) Option B(anchor 기반)를 재권고했으나 **사용자가 Option A 유지 명시 결정**. UI nav는 ±12개월 경계에서 비활성(빈화면 위장 차단).
- **직무 오라클(F9)**: 버튼 순회로 가시범위 코워커 coarse 직무 추론 가능 — 이름 보이는 APPROVED 한정·소규모 외주라 수용. 엄격 비공개 필요시 필터를 status:view/admin에만 노출(후속).
- **CONTRACTOR 강제(F6)**: 연차=외주는 조직정책이며 코드 불변식 아님(정규직 레코드 차단은 별도 작업, 후속).

후속: 인증 후 시각 smoke(직무 버튼·범례·공휴일·경계 nav 비활성). 통합캘린더 구글+연차 합산·공휴일 자동채움(durable sync-state)은 별도 설계.
