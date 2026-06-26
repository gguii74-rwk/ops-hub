# Task 04 — 어댑터 `holidaysToEvents`

**목적:** 공휴일 `{ date, name }[]`을 공통 캘린더 이벤트(`CalendarEventInput`)로 변환하는 `holidaysToEvents`를 추가한다. `kind="HOLIDAY"`, `status` 없음, half-open 단일일. 기존 `Ev`·`leaveToEvents`는 건드리지 않는다(D7).

## Files

- Modify: `src/app/(app)/leave/_components/leave-adapter.ts`
- Test: `tests/app/leave/leave-adapter.test.ts`(**기존 파일** — `leaveToEvents` describe가 이미 있음. 덮어쓰지 말고 describe 추가)

## Prep

- spec §3.4 읽기. 엔트리포인트 §Shared Contracts **S6** 사용.
- 기존 `leaveToEvents`(line 21)가 `allDayHalfOpen(new Date(start), new Date(end))`로 half-open 변환하는 패턴을 그대로 따른다. 공휴일은 시작=종료=같은 날짜.
- `getHolidayEventsInRange`(task-01)가 내려주는 `date`는 `"YYYY-MM-DD"`(UTC). `new Date("YYYY-MM-DD")`는 UTC 자정으로 파싱된다 — `leaveToEvents`가 받는 DB Date(UTC 자정)와 동일 규칙.

## Deps

없음(구조적으로 독립). 논리적으로 task-03의 응답 형태와 짝.

## TDD steps

### Step 1 — 실패 테스트 추가(기존 파일에 describe 추가)

`tests/app/leave/leave-adapter.test.ts`는 이미 존재한다(`leaveToEvents` describe 보유). **덮어쓰지 말고** 다음을 추가한다:

(a) 기존 import 줄을 교체해 `holidaysToEvents`를 추가하고, `allDayHalfOpen` import를 한 줄 더한다:

```ts
import { leaveToEvents, holidaysToEvents, type Ev } from "@/app/(app)/leave/_components/leave-adapter";
import { allDayHalfOpen } from "@/modules/calendar/time";
```

> `eventDayKeys`(`@/modules/calendar/ui/lanes`) import 등 기존 줄은 그대로 둔다.

(b) 파일 끝에 describe 블록을 추가한다:

```ts
describe("holidaysToEvents", () => {
  it("kind=HOLIDAY · status 없음 · id=holiday:date · title=name", () => {
    const out = holidaysToEvents([{ date: "2026-08-15", name: "광복절" }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "holiday:2026-08-15", title: "광복절", kind: "HOLIDAY" });
    expect(out[0].status).toBeUndefined();
  });

  it("half-open 단일일(allDayHalfOpen과 동일 instant)", () => {
    const { start, end } = allDayHalfOpen(new Date("2026-08-15"), new Date("2026-08-15"));
    const out = holidaysToEvents([{ date: "2026-08-15", name: "광복절" }]);
    expect(out[0].start).toBe(start.toISOString());
    expect(out[0].end).toBe(end.toISOString());
  });

  it("빈 입력 → 빈 배열", () => {
    expect(holidaysToEvents([])).toEqual([]);
  });
});
```

### Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/app/leave/leave-adapter.test.ts
```

기대: `holidaysToEvents` 미export로 FAIL.

### Step 3 — 구현

`src/app/(app)/leave/_components/leave-adapter.ts`의 `leaveToEvents`(끝, line 33) **아래**에 추가한다(기존 import·`Ev`·`leaveToEvents` 변경 없음):

```ts
// 공휴일 {date,name} → 공통 모델. kind=HOLIDAY(rose 색), status 없음(오버레이 없음), half-open 단일일(D14).
// date는 "YYYY-MM-DD"(UTC) — leaveToEvents의 DB Date(UTC 자정)와 동일 규칙으로 allDayHalfOpen 처리.
export function holidaysToEvents(hs: { date: string; name: string }[]): CalendarEventInput[] {
  return hs.map((h) => {
    const { start, end } = allDayHalfOpen(new Date(h.date), new Date(h.date));
    return {
      id: `holiday:${h.date}`,
      title: h.name,
      kind: "HOLIDAY",
      start: start.toISOString(),
      end: end.toISOString(),
    };
  });
}
```

> `allDayHalfOpen`·`CalendarEventInput`은 파일 상단에서 이미 import되어 있다(`leaveToEvents`가 사용). 추가 import 불필요.

### Step 4 — 실행(PASS 확인)

```bash
npm test -- tests/app/leave/leave-adapter.test.ts
```

기대: 3건 PASS.

### Step 5 — 커밋

```bash
git add "src/app/(app)/leave/_components/leave-adapter.ts" tests/app/leave/leave-adapter.test.ts
git commit -m "feat(leave): 공휴일 → 캘린더 이벤트 어댑터 holidaysToEvents"
```

## Acceptance Criteria

- `npm test -- tests/app/leave/leave-adapter.test.ts` → 3건 green.
- `npm run typecheck` → 통과.
- `Ev`·`leaveToEvents` 무변경.

## Cautions

- **Don't 공휴일에 `status`/`leaveType` 등 휴가 전용 필드를 채우지 마라.** 이유: 공휴일은 오버레이 없음 — `status` 미설정이라야 `statusOverlay`가 빈 문자열을 반환.
- **Don't `allDayHalfOpen` 대신 직접 `Date.UTC`로 범위를 만들지 마라.** 이유: KST 일자 경계 통일(D14) — 휴가/공휴일이 같은 셀 규칙을 써야 한다.
