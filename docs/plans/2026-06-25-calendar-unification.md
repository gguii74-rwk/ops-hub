# 캘린더 통일 — `CalendarMonth` 단일 컴포넌트 (구현 plan · entrypoint)

> Spec: `docs/specs/2026-06-25-calendar-unification-design.md` (결정 D1~D14). 브랜치 `feat/calendar-unification`.
> 디자인 방향 SSOT: 메모리 `ops-hub-calendar-design-direction.md`(소프트 카드 + 색강도). Aurora 디자인 시스템.

## Goal

업무·연차 두 벌의 월간 캘린더를 **단일 재사용 컴포넌트 `CalendarMonth`**로 통일하고, 두 소비처가 도메인 데이터를 **어댑터로 주입**하게 만든다. 변경은 **클라이언트 표현 계층에 한정** — feed/연차 API·권한 마스킹·연차 도메인 트랜잭션·불변식은 무변경(D10).

## Architecture

`CalendarMonth`(calendar 모듈 `ui/`)는 한 달의 그리드 렌더에만 집중한다 — 기존 `buildMonthGrid`(KST·과거/오늘/미래)로 42칸 스켈레톤을 만들고, 주 단위 lane packing 순수함수(`packWeekLanes`)로 기간 막대를 그리며, 셀 클릭 시 내용 주입형(`renderDayDetail`) 팝오버를 연다. 데이터 패칭·월 네비게이션·로딩/stale 표시는 **소비처(app 레이어)가 보유**한다. 도메인→공통 모델 변환은 **각 소비처의 어댑터**(순수 TS 모듈)가 담당하고, `CalendarMonth`는 도메인을 모른다.

## Tech Stack

Next.js App Router(client component), React 19, Tailwind v4(Aurora 토큰), `@tanstack/react-query`(소비처 패칭, 기존 유지), vitest + `@testing-library/react`(jsdom).

---

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-25-calendar-unification/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

모든 task가 함께 읽는 공통 계약. task 파일은 이 절을 가리킨다(여기 한 곳에만 둔다).

### 파일 맵

| 파일 | task | 종류 |
| --- | --- | --- |
| `src/modules/calendar/ui/event-input.ts` | 01 | 신규 — 공통 이벤트 모델·타입 |
| `src/modules/calendar/ui/lanes.ts` | 01 | 신규 — lane packing 순수함수 |
| `src/modules/calendar/ui/kind-styles.ts` | 02 | 신규 — kind→색·status→오버레이 SSOT |
| `src/modules/calendar/ui/calendar-month.tsx` | 03 | 신규 — 통일 월간 컴포넌트 |
| `src/app/(app)/calendar/feed-adapter.ts` | 04 | 신규 — 통합 feed 어댑터(순수) |
| `src/app/(app)/calendar/calendar-view.tsx` | 04 | 재작성 — 통합 소비처 |
| `src/app/(app)/leave/_components/leave-adapter.ts` | 05 | 신규 — 연차 어댑터(순수, `Ev` 타입 보유) |
| `src/app/(app)/leave/_components/leave-calendar.tsx` | 05 | 재작성 — 연차 소비처(자가신청/관리자 진입 분리) |
| `src/app/(app)/leave/calendar/page.tsx` | 05 | 수정 — `LeaveCalendar`에 `canCreate` prop 전달 |

테스트(신규): `tests/modules/calendar/lanes.test.ts`(01), `tests/modules/calendar/kind-styles.test.ts`(02), `tests/modules/calendar/calendar-month.test.tsx`(03), `tests/app/calendar/feed-adapter.test.ts`(04), `tests/app/leave/leave-adapter.test.ts`·`tests/app/leave/leave-calendar.test.tsx`(05).
**무변경**: `grid.ts`/`grid.test.ts`, `time.ts`/`time.test.ts`, feed/leave API, `create-leave-modal.tsx`, `labels.ts`.

### 공통 이벤트 모델 (`event-input.ts` — task 01이 생성)

```ts
export type Intensity = "soft" | "bold";
export type EventStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface CalendarEventInput {
  id: string;
  title: string;
  kind: string;          // 색 키(KIND_STYLES, D4). 자유 문자열, 미등록 시 중립 폴백.
  start: string;         // ISO instant — half-open 범위 시작(포함). D14.
  end?: string;          // ISO instant — half-open 범위 끝(제외). 생략 = 단일일 [kstDayStart, +1일). D14.
  status?: EventStatus | null; // 오버레이(D5). 색과 직교.
}
```

### 날짜 범위 계약 (D14 — 모든 lane/occupancy 계산의 단일 규약)

`start`/`end`는 **half-open `[start, end)` instant**(KST 일자 기준). 두 출처의 end 의미가 달라 어댑터가 정규화:
- **통합 feed**(`CalEvent`): 이미 half-open(`time.ts` `allDayHalfOpen`) → `start`/`end` **passthrough**(D14①).
- **연차**(`Ev`): `endDate`가 **inclusive 종료일** → `time.ts`의 `allDayHalfOpen(new Date(startDate), new Date(endDate))`로 변환(D14②). 그대로 쓰면 하루 모자람.
- `end` 생략 = 단일일 `[kstDayStart(start), +1일)`(D14③). 해석은 `lanes.ts`의 `eventDayKeys`가 담당.

### `lanes.ts` 시그니처 (task 01)

```ts
import type { GridDay } from "./grid";            // 기존
import type { CalendarEventInput } from "./event-input";

export interface LaneSegment {
  event: CalendarEventInput;
  colStart: number;        // 1..7 (이 주 안 시작 열)
  colEnd: number;          // 1..7 (마지막 점유 열, 포함)
  continuesLeft: boolean;  // 이 주 시작 이전부터 이어짐(◂)
  continuesRight: boolean; // 이 주 끝 이후로 이어짐(▸)
}
export interface LaneRow { segments: LaneSegment[]; }
export interface WeekLanes {
  lanes: LaneRow[];        // maxLanes로 잘린 가시 lane
  more: number[];          // 길이 7, 각 열(col-1 인덱스)에서 잘려 숨겨진 이벤트 수("+N")
}

// 이벤트의 KST 점유 일자(inclusive 키). end 생략·half-open exclusive 보정(-1ms). D14.
export function eventDayKeys(ev: CalendarEventInput): { firstKey: string; lastKey: string };
// 한 날에 걸치는 이벤트(팝오버·목록). lane 잘림과 무관하게 전부 반환.
export function eventsForDay(day: GridDay, events: CalendarEventInput[]): CalendarEventInput[];
// 한 주(7일)의 greedy lane packing. maxLanes 초과분은 more[]로.
export function packWeekLanes(weekDays: GridDay[], events: CalendarEventInput[], maxLanes?: number): WeekLanes;
```

### `kind-styles.ts` 시그니처 (task 02)

```ts
import type { Intensity, EventStatus } from "./event-input";
// kind+intensity → Tailwind 클래스 묶음(리터럴 SSOT, 미등록 kind는 중립 폴백).
export function kindClass(kind: string, intensity: Intensity): string;
// status → 오버레이(형태). 색과 직교. 기본 "".
export function statusOverlay(status?: EventStatus | null): string;
// 색 + 오버레이를 한 번에 합친 칩 클래스(편의). task 03 팝오버 목록·04/05 renderDayDetail에서 사용.
export function eventChipClass(kind: string, intensity: Intensity, status?: EventStatus | null): string;
```

색 매핑(D4, 네비 팔레트 계승): `INTERNAL_LEAVE`→emerald · `EXTERNAL_VACATION`→lime · `WORKFLOW_TASK`→orange · `HOLIDAY`→rose · `EXTERNAL_EVENT`→slate · `PERSONAL_EVENT`→indigo · `TEAM_EVENT`→cyan · (연차 전용 leaveType) `ANNUAL`→emerald · `HALF`→teal · `QUARTER`→cyan. 오버레이(D5): `PENDING`=점선 테두리, `REJECTED`/`CANCELLED`=취소선+흐림, 그 외=기본.
**Tailwind 주의:** 동적 클래스명(`bg-${hue}-100`)은 JIT purge로 깨진다 — 반드시 **완전 리터럴 문자열**로 테이블을 작성한다.

### `CalendarMonth` 인터페이스 (task 03)

```ts
export interface DayDetailContext {
  dateKey: string; iso: string; isPast: boolean; isToday: boolean;
  events: CalendarEventInput[];
  close: () => void;     // 주입 액션이 팝오버를 닫을 수 있게(예: 신청 모달 열기 전)
}
export interface CalendarMonthProps {
  anchor: Date;                                   // 표시 월(KST 정규화는 내부)
  events: CalendarEventInput[];
  intensity?: Intensity;                          // 기본 "bold"
  now?: Date;                                     // 과거/오늘 판정 기준(테스트 주입)
  legend?: boolean;                               // kind 토글 범례(D12)
  legendLabel?: (kind: string) => string;         // 범례 표시명(기본 identity)
  onQuickAdd?: (dateKey: string) => void;         // 주입 시에만 hover/키보드 + 노출(D9)
  renderDayDetail?: (ctx: DayDetailContext) => React.ReactNode; // 팝오버 내용(D8)
}
```

### 핵심 재사용/규칙

- **스켈레톤**: `CalendarMonth`는 `buildMonthGrid(anchor, [], now)`로 42칸 `GridDay`를 얻는다(events=`[]`로 호출 — 날짜 메타데이터만 필요, 이벤트 배치는 `packWeekLanes`가 따로 수행). `grid.ts`는 **무변경**(D10/surgical).
- **범례 해석(D12)**: 내장 범례는 **kind 토글 필터**(색 차원, 보편적). 연차의 **상태(대기/반려·취소)는 오버레이(D5)로 표현**하며 별도 토글 필터로 만들지 않는다 — 소비처가 오버레이 의미를 설명하는 **정적 범례 키**를 컴포넌트 밖에 둔다. (종류=토글, 상태=오버레이 키.)
- **팝오버 형태(D8)**: 중앙 정렬 **인라인 다이얼로그**(raw `<div role="dialog" aria-modal="true">`) — 포커스 트랩(Tab/Shift+Tab)·Esc·바깥클릭·focus 복원·scroll-lock을 `modal.tsx` 동작 그대로 모듈 내부에 재현. **`Modal`(ui) import 금지** — `CalendarMonth`는 `module` 레이어라 `module→ui` boundary 위반(D1/R5). 셀 좌표 앵커링 대신 중앙정렬 — 모바일 견고성(D13)·뷰포트 클램프 자동·테스트 안정성.
- **공휴일 강조(spec §2)**: 공휴일은 통합 feed의 `HOLIDAY` kind 이벤트로 들어와 **rose 색 막대**(D4)로 표시된다 — 이것이 강조다. `CalendarMonth`는 `"HOLIDAY"` 문자열을 특별취급하지 않는다(D2: 도메인 모름) → 셀 별도 틴팅 없음. 주말 요일 헤더만 색 구분(일=rose/토=blue).
- **reduced-motion(D13)**: v1은 팝오버 진입/슬라이드 애니메이션이 없다(즉시 표시). 유일한 transition은 범례 opacity·hover 색뿐(전정기관 자극 없음) → `prefers-reduced-motion`은 구성상 충족(별도 `motion-safe:` 래핑 불필요).
- **불변식 보존(D10)**: 어떤 task도 서버/도메인 호출 시그니처를 바꾸지 않는다. 어댑터는 순수 변환, 신청은 기존 `CreateLeaveModal` 재사용(폼·검증·제출 무변경, D11).
- **boundaries(D1)**: 컴포넌트·순수함수는 `src/modules/calendar/ui/`(module). 두 소비처는 app 레이어라 module·ui import 가능. 어댑터는 각 app 디렉터리.
- **테스트 컨벤션**: 컴포넌트/DOM 테스트는 파일 첫 줄 `// @vitest-environment jsdom` + `@testing-library/react`(`render`/`screen`/`fireEvent`/`cleanup`), `afterEach(cleanup)`. 순수함수 테스트는 기본 node 환경.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 공통 이벤트 모델 + lane packing(순수, TDD) | [ ] | [task-01](2026-06-25-calendar-unification/task-01-event-model-lanes.md) | — | |
| 02 | kind→색 / status→오버레이 SSOT | [ ] | [task-02](2026-06-25-calendar-unification/task-02-kind-styles.md) | 01 | |
| 03 | `CalendarMonth` 컴포넌트 + 테스트 | [ ] | [task-03](2026-06-25-calendar-unification/task-03-calendar-month.md) | 01, 02 | |
| 04 | 통합 소비처(어댑터 + `calendar-view` 재작성) | [ ] | [task-04](2026-06-25-calendar-unification/task-04-calendar-consumer.md) | 01, 03 | |
| 05 | 연차 소비처(어댑터 + `leave-calendar` 재작성, 팝오버 신청) | [ ] | [task-05](2026-06-25-calendar-unification/task-05-leave-consumer.md) | 01, 03 | |

## 수용 기준 (전체, spec §9)

1. 두 캘린더가 동일 `CalendarMonth`로 렌더, 시각(소프트 카드·과거/오늘/미래) 일치.
2. 기간 이벤트 = 연속 막대(주 경계 ◂/▸), 겹치면 lane 분리. **막대 길이 정확**: 연차 inclusive 6/1~6/3 = 3칸, all-day half-open도 의도한 마지막 날까지(하루 초과/미달 없음, D14).
3. 연차에서 종류=색, 상태=오버레이로 구분(D4/D5).
4. 셀 클릭 → 팝오버(통합 읽기전용 / 연차 목록+신청), Esc·바깥클릭 닫힘.
5. 연차 진입이 팝오버/빠른추가로 대체되되 **두 경로가 모두 보존**된다: 자가신청(`canCreate`)→`/leave/request?date=`(라우트 불변), 관리자 직접입력(`canManage`)→`CreateLeaveModal`(불변). 일반 사용자(create 가능·approve-all 불가)도 캘린더 자가신청이 유지된다. 제출 경로·트랜잭션 동작 변화 없음.
6. 휴대폰 폭에서 그리드·막대 안 깨짐, 키보드만으로 셀 이동·팝오버 열기/닫기.
7. `lint`/`typecheck`/`test`/`build` 그린. 서버/도메인 코드 diff 없음.
