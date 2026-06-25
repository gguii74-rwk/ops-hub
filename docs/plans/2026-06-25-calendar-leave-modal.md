# 캘린더 연차 신청·직접입력 팝업 통일 + 종료일 기본값 — 구현 계획

- 스펙: `docs/specs/2026-06-25-calendar-leave-modal-design.md`
- Goal: 연차 캘린더 셀 클릭 시 자가신청도 (관리자 직접입력처럼) 모달로 통일하고, 두 모달 모두 선택 날짜를 종료일까지 기본 지정한다.
- Architecture: 표현계층만 변경. 자가신청 전용 모달 `RequestLeaveModal`을 신설(공유 `Modal`+`LeaveFields` 재사용)해 `POST /api/leave/requests`로 제출하고, `leave-calendar.tsx`의 라우팅 진입을 모달 오픈으로 교체한다. 도메인·API·스키마·마이그레이션 변경 없음.
- Tech Stack: Next.js App Router, React, @tanstack/react-query, vitest + jsdom + Testing Library.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-25-calendar-leave-modal/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

이미 존재하는 공유 폼 모듈 — 그대로 재사용한다(신규 정의 아님). `src/app/(app)/leave/_components/leave-fields.tsx`:

```ts
export interface LeaveFormState {
  leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType: "MORNING" | "AFTERNOON";
  quarterStartTime: string;
  startDate: string;
  endDate: string;
  reason: string;
}
export const emptyLeaveForm: LeaveFormState; // 모든 필드 기본값, startDate/endDate=""
export function LeaveFields(props: {
  state: LeaveFormState;
  set: <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) => void;
}): JSX.Element;
// 폼 상태 → API 페이로드. single(HALF/QUARTER)이면 endDate=startDate로 강제.
export function toLeavePayload(s: LeaveFormState): {
  leaveType: LeaveFormState["leaveType"];
  leaveSubType?: "MORNING" | "AFTERNOON";
  quarterStartTime?: string;
  startDate: string;
  endDate: string;
  reason?: string;
};
```

Task 02가 의존하는 신규 컴포넌트 시그니처(Task 01 산출물):

```ts
// src/app/(app)/leave/_components/request-leave-modal.tsx
export function RequestLeaveModal(props: { onClose: () => void; defaultDate?: string }): JSX.Element;
```

공유 프리미티브: `Modal`(`@/components/ui/modal`, `role="dialog"`+`<h2>title</h2>`), `Button`(`@/components/ui/button`).

테스트 규약: 이 저장소 테스트는 QueryClientProvider를 쓰지 않고 `@tanstack/react-query`를 **모듈 통째로 모킹**한다(기존 `tests/app/leave/leave-calendar.test.tsx` 패턴). react-query를 사용하는 컴포넌트를 렌더하는 테스트는 `useQuery`/`useMutation`/`useQueryClient`를 모두 모킹해야 한다.

## Tasks

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | RequestLeaveModal 신설 + CreateLeaveModal 종료일 기본값 | [ ] | [task-01](2026-06-25-calendar-leave-modal/task-01-request-modal.md) | — | |
| 02 | leave-calendar 진입 모달화 + 테스트 갱신 | [ ] | [task-02](2026-06-25-calendar-leave-modal/task-02-calendar-wiring.md) | 01 | |
