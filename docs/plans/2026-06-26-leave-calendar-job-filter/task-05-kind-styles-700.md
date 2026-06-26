# Task 05 — 칩 색 변형 A(soft 700)

**목적:** 연차 캘린더가 쓰는 kind(`ANNUAL/HALF/QUARTER/HOLIDAY`)의 **soft 라이트모드 글자색을 `text-*-950 → text-*-700`**으로 조정(변형 A). 배경 100·ring·다크모드는 유지. 통합 캘린더 전용 kind와 `statusOverlay`는 건드리지 않는다.

## Files

- Modify: `src/modules/calendar/ui/kind-styles.ts`
- Test: `tests/modules/calendar/kind-styles.test.ts`

## Prep

- spec §3.6 / §5 읽기. 엔트리포인트 §Shared Contracts **S7** 사용.
- 변경 대상 4개 kind의 현재 soft 클래스(라이트모드 글자색만 교체):
  - `ANNUAL`: `text-blue-950` → `text-blue-700`
  - `HALF`: `text-emerald-950` → `text-emerald-700`
  - `QUARTER`: `text-violet-950` → `text-violet-700`
  - `HOLIDAY`: `text-rose-950` → `text-rose-700`
- **변경하지 않는 것:** `bg-*-100`, `ring-1 ring-*-300/70`, `dark:*`, bold 전체, 다른 kind(`INTERNAL_LEAVE`/`WORKFLOW_TASK`/`EXTERNAL_*`/`PERSONAL`/`TEAM`/`EXTERNAL_EVENT`/`PERSONAL_EVENT`/`TEAM_EVENT`), `NEUTRAL`, `statusOverlay`.

## Deps

없음.

## TDD steps

### Step 1 — 실패 테스트 추가(색 단언 갱신)

`tests/modules/calendar/kind-styles.test.ts`의 "연차 전용 leaveType도 색 매핑" 케이스를 변형 A 글자색 단언으로 강화하고, HOLIDAY 케이스를 추가한다. 기존 케이스(`toContain("blue")` 등)는 그대로 두고 700 단언을 덧붙인다:

```ts
  it("연차 전용 leaveType도 색 매핑(ANNUAL=blue, HALF=emerald, QUARTER=violet)", () => {
    expect(kindClass("ANNUAL", "soft")).toContain("blue");
    expect(kindClass("HALF", "soft")).toContain("emerald");
    expect(kindClass("QUARTER", "soft")).toContain("violet");
  });

  it("변형 A: soft 라이트모드 글자색 700(ANNUAL/HALF/QUARTER/HOLIDAY)", () => {
    expect(kindClass("ANNUAL", "soft")).toContain("text-blue-700");
    expect(kindClass("HALF", "soft")).toContain("text-emerald-700");
    expect(kindClass("QUARTER", "soft")).toContain("text-violet-700");
    expect(kindClass("HOLIDAY", "soft")).toContain("text-rose-700");
    // 배경·ring은 유지
    expect(kindClass("ANNUAL", "soft")).toContain("bg-blue-100");
    expect(kindClass("HOLIDAY", "soft")).toContain("bg-rose-100");
    // 950(이전 톤)은 더 이상 없음
    expect(kindClass("ANNUAL", "soft")).not.toContain("text-blue-950");
    expect(kindClass("HOLIDAY", "soft")).not.toContain("text-rose-950");
  });
```

### Step 2 — 실행(FAIL 확인)

```bash
npm test -- tests/modules/calendar/kind-styles.test.ts
```

기대: 새 "변형 A" 케이스가 `text-*-700` 부재로 FAIL.

### Step 3 — 구현

`src/modules/calendar/ui/kind-styles.ts`의 `HOLIDAY`·`ANNUAL`·`HALF`·`QUARTER` soft 문자열에서 라이트모드 글자색만 교체한다.

`HOLIDAY`(line 25):

```ts
  HOLIDAY: {
    soft: "bg-rose-100 text-rose-700 ring-1 ring-rose-300/70 dark:bg-rose-500/20 dark:text-rose-100 dark:ring-rose-300/30",
    bold: "bg-rose-500 text-white ring-1 ring-rose-600/40 dark:bg-rose-500/80 dark:text-rose-50 dark:ring-rose-400/40",
  },
```

`ANNUAL`(line 42):

```ts
  ANNUAL: {
    soft: "bg-blue-100 text-blue-700 ring-1 ring-blue-300/70 dark:bg-blue-500/20 dark:text-blue-100 dark:ring-blue-400/30",
    bold: "bg-blue-500 text-white ring-1 ring-blue-600/40 dark:bg-blue-500/80 dark:text-blue-50",
  },
```

`HALF`(line 46):

```ts
  HALF: {
    soft: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300/70 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-400/30",
    bold: "bg-emerald-500 text-white ring-1 ring-emerald-600/40 dark:bg-emerald-500/80 dark:text-emerald-50",
  },
```

`QUARTER`(line 50):

```ts
  QUARTER: {
    soft: "bg-violet-100 text-violet-700 ring-1 ring-violet-300/70 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-400/30",
    bold: "bg-violet-500 text-white ring-1 ring-violet-600/40 dark:bg-violet-500/80 dark:text-violet-50",
  },
```

> 각 항목에서 **`text-*-950` → `text-*-700` 한 토큰만** 바뀐다. bold·다크·배경·ring은 동일.

### Step 4 — 실행(PASS 확인)

```bash
npm test -- tests/modules/calendar/kind-styles.test.ts
```

기대: 신규 "변형 A" + 기존 케이스 전부 PASS.

### Step 5 — 커밋

```bash
git add src/modules/calendar/ui/kind-styles.ts tests/modules/calendar/kind-styles.test.ts
git commit -m "feat(calendar): 연차 kind soft 글자색 700(변형 A 범례 통일)"
```

## Acceptance Criteria

- `npm test -- tests/modules/calendar/kind-styles.test.ts` → 신규+기존 green.
- `npm run typecheck` → 통과.
- `INTERNAL_LEAVE`/`WORKFLOW_TASK`/`EXTERNAL_*`/`PERSONAL`/`TEAM`/`NEUTRAL`·bold·`statusOverlay` 무변경.

## Cautions

- **Don't bold 클래스나 다크모드(`dark:text-*-100`)를 바꾸지 마라.** 이유: 변형 A는 soft 라이트모드 글자색만 대상(배경·테두리·다크 유지).
- **Don't 통합 캘린더 전용 kind를 함께 손대지 마라.** 이유: 범위 밖(spec §3.6). `HOLIDAY`는 통합 캘린더와 공유라 700이 전파되지만 무해·일관(의도된 결과).
