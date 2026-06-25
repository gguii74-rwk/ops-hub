---
name: ops-hub-calendar-design-direction
description: ops-hub 통합 캘린더 디자인=소프트 카드 고정+색강도 3안(연차 soft·업무 bold); 향후 캘린더 화면은 palette×kind색×셀클릭동작 3축으로 요청
metadata: 
  node_type: memory
  type: project
  originSessionId: 67c8886b-d844-4719-9fdc-9eb7015da461
---

ops-hub 업무·연차 및 향후 일정성 모듈(예약·회의실·교육 등)이 공유할 월간 캘린더 디자인 방향. **SDD impl 완료 → PR #22 머지(merge commit `91d808b`) + kgs-dev 배포 완료(2026-06-25, 브랜치 `feat/calendar-unification`).** 5/5 task 완료(commits 0b282e8·583180a·d700a6f·6fb4101·d72f9a9), 최종 whole-branch 리뷰 opus=merge-ready(Critical/Important 0), **impl 단계 codex 적대검증 R1=approve·0 findings**(lint/typecheck 통과·Vitest는 codex sandbox read-only 권한으로만 차단=코드결함 아님→로컬 1359 통과로 충족), typecheck/lint/test 1359/build green, no-AI-trace clean. **배포 = dev 표준 restart**(마이그레이션·deps·권한 catalog 변경 없음=표현계층만 → 서버 main pull→`npm run build`(green, `/calendar`·`/leave/calendar` 라우트 정상)→`pm2 restart ops-hub`, Ready 705ms). HTTP smoke 통과: `/login` 200, 보호 라우트 `/calendar`·`/leave/calendar` 307(미인증 리다이렉트), `/api/calendar/feed` 401(fail-closed), pm2 error.log clean(P2010 무관-advisory-lock 경로 미변경). **잔여 = 인증 후 시각 smoke**(렌더+팝오버+일반사용자 자가신청 1건)는 LAN `http://172.21.10.27:3200`에서 수동 — 폰은 NEXTAUTH_URL=LAN이라 막힘. plan = `docs/plans/2026-06-25-calendar-unification.md`(엔트리포인트 + 5 task: ①event-input+lanes ②kind-styles ③CalendarMonth ④통합 소비처 ⑤연차 소비처). spec 핵심: 단일 `CalendarMonth`(`src/modules/calendar/ui/`, boundaries상 components/ui 불가) + 신규 `lanes.ts`/`kind-styles.ts`, 두 소비처(통합 bold·연차 soft) 어댑터, half-open `[start,end)` 계약(D14, 연차 inclusive는 `allDayHalfOpen` 변환), 표현 계층만(불변식 보존). 구현 결과: PERSONAL_EVENT 색은 blue→**indigo**(D4)로 정착.

**plan 적대검증(6회, approve)에서 굳힌 결정 — impl 시 필수:** ① 연차 진입은 **두 경로 분리**(자가신청 `canCreate`→`router.push('/leave/request?date=')` 라우트 보존 / 관리자 `canManage`→`CreateLeaveModal`) — `canManage` 하나로 병합 금지(일반 사용자 자가신청 회귀). ② 연차 패칭은 **42칸 그리드 윈도우**(`normalizeToGridWindow`)로(인접월 가짜 빈칸 방지). ③ cursor는 **KST 파생**(`toKstDateKey`, UTC면 월초 0~9시 전월). ④ 팝오버 events는 캡처 말고 **렌더 시 `visible`에서 파생**(리패칭 stale 방지). ⑤ 팝오버 포커스 트랩은 **`CalendarMonth` 내부 인라인 구현**(modal.tsx 동작 복제) — **`@/components/ui/*` import 금지**(module→ui boundary 위반). app 소비처(어댑터·페이지)만 ui 사용 가능.

**확정 (2026-06-25, 목업 3시안→소프트 카드 선택→색강도 3안→매핑 확정):**
- 레이아웃 = **소프트 카드**(떠있는 라운드 카드 셀 + gap). 단일 재사용 컴포넌트 `CalendarMonth`로 통일 — 현재 분리된 `src/app/(app)/calendar/calendar-view.tsx`(통합, 좋은 그리드 로직 `buildMonthGrid` 보유)와 `src/app/(app)/leave/_components/leave-calendar.tsx`(연차, 과거/오늘 구분·기간막대·팝오버 없음)를 합치고 격차를 메운다.
- **색 강도 3안**: `soft`(옅은 종류색 배경+컬러 점) / `bold`(종류색 채움+밝은 텍스트) / `minimal`(무채색+좌측 컬러바). 매핑 = **연차=soft, 업무=bold**.
- 공통 표준(팔레트 무관, 매번 재디자인 불필요): 시간 방향(지난날 가라앉음·오늘 브랜드블루 채움+링·미래 떠있음), **기간 이벤트 연속 막대**(CSS grid column-span + 주 단위 lane packing, 달 경계는 ◂/▸), 셀 클릭 **팝오버**(내용·액션은 호출부 주입), 범례 클릭 필터, hover 빠른추가(+), 공휴일 날짜 강조, 키보드 포커스·Esc·reduced-motion.
- 이벤트 모델 = `{ id, title, kind, start, end?, status? }`. kind 색 = 네비 팔레트 계승(연차 emerald·업무 orange·팀 cyan·공휴일 rose·개인 indigo·외부 slate). status = 대기(점선)·반려(취소선) 오버레이. 도메인 규칙(지난날 연차신청 차단 등)은 주입 액션에서 처리.

**향후 캘린더 화면 요청 규격(사용자 합의):** 화면마다 3축만 지정 — ① 색강도(soft/bold/minimal; 기본: 상태·승인 중심→soft, 다출처 합성→bold) ② 이벤트 종류+색(네비 팔레트) ③ 날짜 클릭 동작. 예: "표준 CalendarMonth, bold, 종류=내예약/타인예약/점검, 클릭→예약 생성" 또는 "연차랑 같은 캘린더로".

기반 디자인 시스템 = Aurora [[ops-hub-admin-ui-design-direction]]. 토큰 SSOT = `src/app/globals.css`(브랜드 #2563EB, 네비 팔레트), 프리미티브 `src/components/ui/`.
