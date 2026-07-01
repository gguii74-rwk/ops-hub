# Task 07 — 기존 캘린더 에러상태 통일 (leave-calendar isError 배너)

전 캘린더 화면의 조회 실패 처리를 통일한다(SC-13). 기존 `leave-calendar.tsx`는 `useQuery`의 `data`만 쓰고 실패 시 `data?.x ?? []`로 조용히 빈 캘린더를 렌더한다(silent failure — 실제 연차가 있어도 없는 것처럼 보임). 통합 캘린더(`calendar-view.tsx`)가 이미 가진 정본 패턴(`isError` 배너)을 leave-calendar에도 적용한다. (신규 `workflows-calendar`는 task-05에서 이미 SC-13 반영. `calendar-view`는 이미 준수 — 변경 없음.)

## Files
- Modify: `src/app/(app)/leave/_components/leave-calendar.tsx` (`useQuery` `isError` 구독 + 에러 배너)
- Test: `tests/app/leave/leave-calendar.test.tsx` (mock에 `isError` 지원 + 에러상태 테스트)

## Prep
- 엔트리포인트 §Shared Contracts SC-13(조회 실패 에러상태 통일).
- 정본: `src/app/(app)/calendar/calendar-view.tsx` line 125(`{query.isError && <p className="text-sm text-destructive">캘린더를 불러오지 못했습니다.</p>}`).
- 대상 파일 현재 구조: `leave-calendar.tsx`의 `const { data } = useQuery(...)`(47행)·`data?.events ?? []`(59행)·`<CalendarMonth .../>` 종료 뒤 모달(182~189행).

## Deps
없음(기존 leave-calendar만 수정 — 다른 태스크와 독립).

## Cautions
- **Don't `data?.x ?? []` 빈 폴백을 제거하지 마라.** 로딩·부분 데이터 렌더를 위해 유지한다. `isError` 배너는 **병행** 노출(폴백 대체 아님, SC-13).
- **Don't `calendar-view.tsx`를 건드리지 마라.** 이미 `isError` 배너를 가진 정본 참조원이다(무변경).
- **Don't 기존 테스트를 깨지 마라.** mock에 `isError` 필드를 **additive**로 추가(기본 false) — `isError` 미설정 기존 테스트는 배너 미노출로 그대로 통과.
- **Don't 배너를 차단 모달로 만들지 마라.** `unsyncedYears` 안내(126~130행)와 동일하게 그리드와 공존하는 인라인 안내 문구.

## TDD Steps

### 1. 테스트 mock에 isError 지원 + 실패 테스트 먼저

`tests/app/leave/leave-calendar.test.tsx` 상단 mock을 교체(additive `isError`):

```tsx
const h = vi.hoisted(() => ({
  queryData: { events: [] as unknown[], holidays: [] as unknown[], unsyncedYears: [] as number[] },
  isError: false,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.isError ? undefined : h.queryData, isError: h.isError }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));
```

`beforeEach`에 리셋 추가:

```tsx
beforeEach(() => {
  h.queryData = { events: [], holidays: [], unsyncedYears: [] };
  h.isError = false;
});
```

파일 하단에 describe 추가:

```tsx
describe("LeaveCalendar — 조회 실패 에러상태(SC-13)", () => {
  it("조회 실패 시 에러 배너 노출(빈 캘린더로 위장 안 함)", () => {
    h.isError = true;
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.getByText("연차 캘린더를 불러오지 못했습니다.")).toBeTruthy();
  });

  it("정상(비-에러) 시 에러 배너 없음", () => {
    render(<LeaveCalendar canCreate canManage={false} />);
    expect(screen.queryByText("연차 캘린더를 불러오지 못했습니다.")).toBeNull();
  });
});
```

실행: `npm test -- tests/app/leave/leave-calendar.test.tsx` → **FAIL**(컴포넌트가 `isError`를 렌더하지 않음). 기존 테스트는 계속 통과(mock additive).

### 2. leave-calendar 구현

`src/app/(app)/leave/_components/leave-calendar.tsx`:

(a) `useQuery` 구조분해에 `isError` 추가(47행):

```tsx
  const { data, isError } = useQuery({
```

(b) `<CalendarMonth .../>` 종료 직후(모달 렌더 앞, 182~184행 사이)에 에러 배너 추가:

```tsx
      {/* 조회 실패 에러상태(SC-13) — 빈 캘린더 위장 금지. 정본=calendar-view line 125. */}
      {isError && (
        <p className="text-sm text-destructive">연차 캘린더를 불러오지 못했습니다.</p>
      )}
```

(나머지 — 직무 필터·범례·`unsyncedYears` 안내·팝오버·모달은 **불변**.)

실행: `npm test -- tests/app/leave/leave-calendar.test.tsx` → **PASS**.

### 3. 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/app/leave/leave-calendar.test.tsx
```
기대: 전부 green(기존 leave-calendar 테스트도 회귀 없음 — mock additive). 이후 커밋.

## Acceptance Criteria
- `npm run typecheck` → 통과.
- `npm run lint` → 통과.
- `npm test -- tests/app/leave/leave-calendar.test.tsx` → 통과(기존 케이스 + 신규 에러상태 2건).
- leave-calendar: `isError` 시 "연차 캘린더를 불러오지 못했습니다." 배너 노출(빈 캘린더 위장 안 함), 정상 시 미노출; `data?.x ?? []` 빈 폴백 유지(병행).
- `calendar-view.tsx` 무변경(이미 준수). 세 캘린더(통합·연차·업무) 모두 조회 실패 시 에러 배너 노출(SC-13 통일 달성).
