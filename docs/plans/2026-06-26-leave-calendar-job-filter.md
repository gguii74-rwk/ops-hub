# 연차 캘린더 직무 필터 + 범례 통일 + 공휴일 표시 — 구현 계획

- 작성일: 2026-06-26
- spec: `docs/specs/2026-06-26-leave-calendar-job-filter-design.md`(D1~D10 확정)
- 대상: 연차 캘린더(`/leave/calendar` → `LeaveCalendar`)

## Goal

연차 캘린더에 **서버측 직무 필터**(데이터 최소화), **변형 A 정적 범례**, **공휴일 표시(read-only + 미동기화 신호)**, **nav 우측 레이아웃**을 추가한다.

## Architecture

표현계층 + 조회 경로만 바꾸는 변경이다. 마이그레이션·도메인 불변식 변경 없음. 직무 필터는 서버(`getLeaveCalendar`)가 권한 스코프와 직무 userId 집합을 **교집합**해 적용하고, 응답에 `jobFunction`을 싣지 않는다. 공휴일은 `Holiday` 테이블을 **있는 그대로 읽고**(동기화 트리거 없음), 미적재/실패 연도는 `unsyncedYears` 신호로 노출한다. 라우트는 조회 윈도우(start≤end·≤46일·운영창)를 검증한다.

## Tech Stack

Next.js App Router(route handler) · Prisma(PostgreSQL) · React + @tanstack/react-query · vitest(+ jsdom/Testing Library) · 공통 캘린더 프리미티브(`CalendarMonth`, `kind-styles`, `time`).

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-26-leave-calendar-job-filter/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

---

## Shared Contracts

2개 이상 태스크가 공유하는 타입·시그니처·상수. 태스크 파일은 이 절을 가리키고 재인라인하지 않는다.

### S1. `JobFunction` 타입

```ts
// @prisma/client (서버) 와 @/lib/auth/types (클라이언트) 양쪽에 동일 값 존재.
type JobFunction = "PM" | "DEVELOPER" | "CONTENT_MANAGER" | "CIVIL_RESPONSE";
```

- 서버(서비스·라우트)는 `import type { JobFunction } from "@prisma/client"`.
- 클라이언트(컴포넌트)는 `import type { JobFunction } from "@/lib/auth/types"`.
- **직무 필터 화이트리스트(버튼 4개, PM 제외 — spec D2):** `ALL | DEVELOPER | CIVIL_RESPONSE | CONTENT_MANAGER`.

### S2. 공휴일 조회 — `src/kernel/holidays/index.ts`

```ts
// 신규(task-01). [start,end] 범위 공휴일을 날짜·이름으로(빈 결과 정상). date="YYYY-MM-DD"(UTC).
export async function getHolidayEventsInRange(
  start: Date,
  end: Date,
): Promise<{ date: string; name: string }[]>;

// 기존(task-03이 소비). 인자 연도 중 count===0 미적재 연도 반환.
export async function getUnsyncedYears(years: number[]): Promise<number[]>;
```

- 기존 `getHolidaysInRange`(Set, 신청 검증용)·`ensureYearsSynced`·`syncHolidaysForYear`는 **건드리지 않는다**.
- **read 경로에서 동기화를 호출하지 않는다(D8):** `ensureYearsSynced`/`syncHolidaysForYear`는 라우트가 부르지 않는다.

### S3. 휴가 조회 서비스 — `src/modules/leave/services/calendar.ts`

```ts
export async function getLeaveCalendar(params: {
  viewerId: string;
  canViewAllStatuses: boolean;
  canCrossTeam: boolean;
  start: Date;
  end: Date;
  filterTeamId?: string | null;
  job?: JobFunction | null; // 신규(task-02). null/미지정 = 무필터.
}): Promise<LeaveCalendarEvent[]>;
```

- `LeaveCalendarEvent`(기존)에는 **`jobFunction`을 추가하지 않는다**(D7, 데이터 최소화). 기존 필드: `id,userId,name,leaveType,leaveSubType,quarterStartTime,startDate,endDate,status,reason,isSelf`.

### S4. 연차 캘린더 API 응답 형태(task-03·task-06 공유)

```ts
// GET /api/leave/calendar?start&end&job&teamId
// 기존 { events } 에서 확장(D6/D9).
interface CalendarResponse {
  events: Ev[];                              // 휴가(서버가 권한×직무로 이미 필터)
  holidays: { date: string; name: string }[]; // 공휴일(직무와 무관·항상)
  unsyncedYears: number[];                   // 공휴일 신뢰 불가 연도(미적재 OR 실패). 비어있으면 정상.
}
```

- **불변식(D9):** `{ holidays: [], unsyncedYears: [] }`는 **'윈도우 연도 모두 적재됨 + 진짜 공휴일 없음'일 때만** 발생. 미적재·실패는 절대 깨끗한 빈 상태로 둔갑하지 않는다.

### S5. 윈도우 입력 검증 상수·헬퍼(task-03)

```ts
import { isAnchorWithinWindow } from "@/modules/calendar/time"; // (anchor, now, maxMonths) => boolean
import { MAX_ANCHOR_MONTHS } from "@/modules/calendar/constants"; // = 12
const MS_PER_DAY = 86_400_000;
const MAX_WINDOW_DAYS = 46; // 월 그리드 한 화면(≤6주) — feed normalizeToGridWindow와 동일 폭(D10)
```

- 검증 3종(위반 시 400): ① `start <= end` ② `end - start <= 46일` ③ `start`·`end` 양 끝 모두 `isAnchorWithinWindow(_, now, MAX_ANCHOR_MONTHS)`.
- 400은 `LeaveValidationError`(`@/modules/leave/errors`)를 throw → `mapError`(`@/app/api/leave/_shared`)가 400으로 매핑.

### S6. 어댑터 — `src/app/(app)/leave/_components/leave-adapter.ts`

```ts
// 신규(task-04). 공휴일 → 공통 이벤트. kind="HOLIDAY", status 없음, half-open 단일일.
export function holidaysToEvents(hs: { date: string; name: string }[]): CalendarEventInput[];
```

- 기존 `Ev`·`leaveToEvents`는 **건드리지 않는다**(직무 필터가 서버로 이동 → 추가 필드 불필요, D7).
- `CalendarEventInput`(공통 모델): `{ id, title, kind, start, end?, status? }`(`@/modules/calendar/ui/event-input`). half-open 변환은 `allDayHalfOpen`(`@/modules/calendar/time`).

### S7. 칩 색 — `src/modules/calendar/ui/kind-styles.ts`(변형 A, task-05)

- `ANNUAL/HALF/QUARTER/HOLIDAY`의 **soft 라이트모드 글자색 `text-*-950 → text-*-700`**. 배경 100·ring(테두리)·다크모드(`dark:text-*-100`) 유지.
- 매핑: `ANNUAL=text-blue-700` · `HALF=text-emerald-700` · `QUARTER=text-violet-700` · `HOLIDAY=text-rose-700`.
- 통합 캘린더 전용 kind(`INTERNAL_LEAVE`/`WORKFLOW_TASK`/`EXTERNAL_*`/`PERSONAL`/`TEAM`)·`statusOverlay`는 **건드리지 않는다**.

### S8. 검증 명령(모든 태스크 공통 AC)

```bash
npm run typecheck   # tsc --noEmit — 통과
npm run lint        # eslint(boundaries 포함) — 통과
npm test            # vitest run — 전체 green
```

- **module→ui import 금지**(eslint boundaries): 컴포넌트는 `(app)` 영역이라 무관하지만, `src/modules/*`에서 `@/components/ui/*`를 import하지 않는다.
- **no-AI-trace:** 커밋 메시지·코드 주석에 AI/codex 흔적 금지(기술 근거만).

---

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 공휴일 범위 조회 `getHolidayEventsInRange` | [ ] | [task-01](2026-06-26-leave-calendar-job-filter/task-01-holidays-range.md) | — | |
| 02 | 서비스 직무 필터(`job` 교집합, jobFunction 미노출) | [ ] | [task-02](2026-06-26-leave-calendar-job-filter/task-02-service-job-filter.md) | — | |
| 03 | API 라우트(윈도우 검증·job 파싱·`{events,holidays,unsyncedYears}`·D9 불변식·read-only) | [ ] | [task-03](2026-06-26-leave-calendar-job-filter/task-03-calendar-route.md) | 01, 02 | |
| 04 | 어댑터 `holidaysToEvents` | [ ] | [task-04](2026-06-26-leave-calendar-job-filter/task-04-leave-adapter.md) | — | |
| 05 | 칩 색 변형 A(soft 700) | [ ] | [task-05](2026-06-26-leave-calendar-job-filter/task-05-kind-styles-700.md) | — | |
| 06 | 컴포넌트(직무 버튼·정적 범례·공휴일 병합·미동기화 안내·nav 우측) | [ ] | [task-06](2026-06-26-leave-calendar-job-filter/task-06-leave-calendar-ui.md) | 03, 04, 05 | |

실행 순서 권장: 01 → 02 → 03 → 04 → 05 → 06(01/02/04/05는 상호 독립, 03은 01·02, 06은 03·04·05 필요).
