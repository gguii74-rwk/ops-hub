# Task 01 — 공휴일 범위 조회 `getHolidayEventsInRange`

**목적:** `Holiday` 테이블에서 `[start, end]` 범위의 공휴일을 `{ date, name }[]`로 읽는 read-only 헬퍼를 추가한다(캘린더 표시용). 기존 `getHolidaysInRange`(Set, 신청 검증용)는 그대로 둔다.

## Files

- Modify: `src/kernel/holidays/index.ts` — `getHolidayEventsInRange` 추가
- Test: `tests/kernel/holidays/index.test.ts` — describe 블록 추가

## Prep

- spec §3.1 읽기. 엔트리포인트 §Shared Contracts **S2** 사용.
- 기존 `getHolidaysInRange`(line 5)와 동일한 날짜키 규칙(`r.date.toISOString().slice(0,10)`, UTC "YYYY-MM-DD")·동일 prisma 패턴을 따른다.

## Deps

없음.

## TDD steps

### Step 1 — 실패 테스트 추가

`tests/kernel/holidays/index.test.ts`의 기존 import 줄(`getHolidaysInRange, ensureYearsSynced, syncHolidaysForYear, getUnsyncedYears`)에 `getHolidayEventsInRange`를 추가하고, 파일 끝에 describe 블록을 추가한다.

import 줄 교체:

```ts
import { getHolidaysInRange, getHolidayEventsInRange, ensureYearsSynced, syncHolidaysForYear, getUnsyncedYears } from "@/kernel/holidays";
```

파일 끝에 추가:

```ts
describe("getHolidayEventsInRange", () => {
  it("범위 공휴일을 {date,name}[]로(YYYY-MM-DD·정렬·gte/lte where)", async () => {
    findMany.mockResolvedValue([
      { date: new Date("2026-01-01T00:00:00.000Z"), name: "신정" },
      { date: new Date("2026-03-01T00:00:00.000Z"), name: "삼일절" },
    ]);
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-03-31T00:00:00.000Z");
    const out = await getHolidayEventsInRange(start, end);
    expect(out).toEqual([
      { date: "2026-01-01", name: "신정" },
      { date: "2026-03-01", name: "삼일절" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { date: { gte: start, lte: end } },
      select: { date: true, name: true },
      orderBy: { date: "asc" },
    });
  });

  it("빈 결과 정상(빈 배열)", async () => {
    findMany.mockResolvedValue([]);
    expect(await getHolidayEventsInRange(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T00:00:00.000Z"))).toEqual([]);
  });
});
```

> 비고: 이 테스트 파일은 상단 `vi.hoisted`에서 `findMany`/`count`를 이미 mock 한다(`prisma.holiday.findMany`로 연결). 추가 mock 불필요.

### Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/kernel/holidays/index.test.ts
```

기대: `getHolidayEventsInRange is not a function`(또는 import 에러)로 새 테스트 FAIL.

### Step 3 — 구현

`src/kernel/holidays/index.ts`의 기존 `getHolidaysInRange`(line 5~8) **바로 아래**에 추가한다(import·기존 함수 변경 없음):

```ts
/** [start, end] 범위의 공휴일을 표시용 {date,name}[]로. date는 "YYYY-MM-DD"(UTC). 빈 결과 정상. */
export async function getHolidayEventsInRange(start: Date, end: Date): Promise<{ date: string; name: string }[]> {
  const rows = await prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true, name: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), name: r.name }));
}
```

### Step 4 — 실행(PASS 확인)

```bash
npm test -- tests/kernel/holidays/index.test.ts
```

기대: 새 describe 2건 + 기존 케이스 전부 PASS.

### Step 5 — 커밋

```bash
git add src/kernel/holidays/index.ts tests/kernel/holidays/index.test.ts
git commit -m "feat(leave): 공휴일 범위 조회 getHolidayEventsInRange 추가(캘린더 표시용)"
```

## Acceptance Criteria

- `npm test -- tests/kernel/holidays/index.test.ts` → 새 describe 포함 전부 green.
- `npm run typecheck` → 통과.
- 기존 `getHolidaysInRange`/`ensureYearsSynced`/`syncHolidaysForYear`/`getUnsyncedYears` 시그니처·동작 무변경.

## Cautions

- **Don't `getHolidaysInRange`를 수정/대체하지 마라.** 이유: 신청 fail-closed 게이트(`createLeaveRequest`)가 Set 형태를 소비한다 — 별개 함수다.
- **Don't `select`에서 `year` 등 다른 컬럼을 추가하지 마라.** 이유: 표시에 `date,name`만 필요(데이터 최소화). 정렬은 `date asc` 고정.
