---
name: calendar-leave-modal-merged
description: 캘린더 자가신청 진입을 모달로 통일 + 두 모달 종료일 기본값; PR
metadata: 
  node_type: memory
  type: project
  originSessionId: c7290e35-6882-4aad-b82a-ced931a4afda
---

연차 캘린더 셀 클릭 진입 UX 개선 — **PR #23 머지(merge commit `2214aff`) + kgs-dev 배포 완료**(2026-06-25, 브랜치 `feat/calendar-leave-modal`).

무엇:
- 자가신청 진입(`+` 빠른추가 · 팝오버 "이 날짜로 연차 신청")을 `/leave/request` 페이지 라우팅에서 **모달(`RequestLeaveModal`) 오픈**으로 통일(관리자 직접입력 `CreateLeaveModal`은 이미 모달). → PR #22([[ops-hub-calendar-design-direction]])의 "자가신청 라우트 보존" 불변식을 **의도적으로 교체**.
- 자가/관리자 두 모달 모두 선택 날짜를 startDate·endDate **양쪽**에 기본 지정.
- `RequestLeaveModal`은 공유 `Modal`·`LeaveFields`·`toLeavePayload` 재사용, `POST /api/leave/requests`(폼만, UserSelect·알림 없음). canCreate/canManage 두 권한 경로 분리 유지.
- `/leave/request` 페이지·네비 진입은 보존(직접 진입 경로).

**제출 중(in-flight POST) 모달 닫기 = 차단(가드 유지)이 확정 결정.** review-loop에서 codex가 "닫혀서 결과 유실" ↔ "닫기 차단이 hang 시 trap"을 양쪽으로 번갈아 지적(churn). 사용자가 **닫기 차단 유지**를 선택 → 두 모달 모두 `m.isPending` 중 Esc/배경/취소 차단 + 취소 버튼 disabled. 반대편(trap-on-hang)은 **ACCEPTED**(내부 LAN API 무한 hang 드묾, 결과 가시성 우선). 보완책=운영서 hang 관측 시 AbortController+타임아웃. **이 트레이드오프 재논의 말 것.**

표현계층만(마이그레이션 없음=표준 restart). test 1363 green. 인증 후 시각 smoke(셀 클릭→팝업·종료일 채움)는 LAN 172.21.10.27:3200 수동 잔여.
