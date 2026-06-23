# Task 02 — app-nav active 판정 정밀화(형제 최장 매칭)

사이드바 자식 중 현재 경로와 매칭되는 **가장 긴 href 1개만** active로 둔다. 인덱스 자식(`대시보드`→`/leave`)이 형제 하위경로(`/leave/request`)에서도 prefix로 잡히는 충돌을 없앤다. 순수 함수 변경 → TDD.

## Files

- Modify: `src/app/(app)/app-nav.tsx` — `computeNavRows`(현재 74~90행)
- Modify: `tests/app/nav/compute-nav-rows.test.ts` — describe 블록 **추가**(기존 블록은 건드리지 않음)

## Prep

- 엔트리포인트 §Shared Contracts **C3**(active 판정 규칙) 숙지.
- spec D8. `isActiveHref` 시그니처·동작은 **불변**.
- 기존 테스트 구조(`leaf` 헬퍼, describe 패턴)는 `tests/app/nav/compute-nav-rows.test.ts` 상단 참고.

## Deps

없음. (task-01과 독립 — 단, /leave/manage 경로는 task-03에서 실제 생성되며, 본 테스트는 순수 함수에 임의 경로를 넣는 단위 테스트라 라우트 존재와 무관.)

## Steps

### 1. 실패 테스트 추가

`tests/app/nav/compute-nav-rows.test.ts` **맨 끝에** describe 블록을 추가한다(파일 상단의 import·`leaf` 헬퍼 재사용, 기존 블록은 그대로):

```ts
describe("computeNavRows — 형제 최장 매칭 우선(D8)", () => {
  const leave: NavItem = {
    key: "leave", label: "연차", href: "/leave",
    children: [
      leaf("leave-dashboard", "/leave"),
      leaf("leave-request", "/leave/request"),
      leaf("leave-calendar", "/leave/calendar"),
      leaf("leave-history", "/leave/history"),
      leaf("leave-manage", "/leave/manage"),
    ],
  };
  const items: NavItem[] = [leaf("dashboard", "/dashboard"), leave];

  const childActiveKeys = (pathname: string) =>
    computeNavRows(items, pathname)
      .find((r) => r.key === "leave")!
      .children.filter((c) => c.active)
      .map((c) => c.key);

  it("/leave → 대시보드(인덱스)만 active", () => {
    expect(childActiveKeys("/leave")).toEqual(["leave-dashboard"]);
  });

  it("/leave/request → 연차 신청만 active(대시보드 아님)", () => {
    expect(childActiveKeys("/leave/request")).toEqual(["leave-request"]);
  });

  it("/leave/manage/allocations → 연차 관리만 active(prefix 최장)", () => {
    expect(childActiveKeys("/leave/manage/allocations")).toEqual(["leave-manage"]);
  });

  it("부모 연차는 모든 /leave/* 에서 active·자동펼침", () => {
    for (const p of ["/leave", "/leave/request", "/leave/manage/status"]) {
      const row = computeNavRows(items, p).find((r) => r.key === "leave")!;
      expect(row.active, p).toBe(true);
      expect(row.autoExpanded, p).toBe(true);
    }
  });

  it("연차 외 경로(/dashboard)면 자식 active 없음", () => {
    expect(childActiveKeys("/dashboard")).toEqual([]);
  });
});
```

실행(현재 구현은 자식 active를 단순 `isActiveHref`로 잡음 → `/leave/request`·`/leave/manage/allocations`에서 `대시보드`도 active로 잡혀 FAIL 예상):

```
npm test -- tests/app/nav/compute-nav-rows.test.ts
```

### 2. `computeNavRows` 정밀화(구현)

`src/app/(app)/app-nav.tsx`의 기존 함수(74~90행):

```ts
// 렌더 결정을 순수 계산으로 분리(DOM 없이 테스트). 펼침 토글은 컴포넌트 상태가 보강.
export function computeNavRows(items: NavItem[], pathname: string): NavRow[] {
  return items.map((item) => {
    const children: NavChildRow[] = item.children.map((c) => ({
      key: c.key, label: c.label, href: c.href, active: isActiveHref(c.href, pathname),
    }));
    const selfActive = isActiveHref(item.href, pathname);
    const childActive = children.some((c) => c.active);
    return {
      key: item.key, label: item.label, href: item.href,
      isLink: item.href != null,
      active: selfActive || childActive,
      autoExpanded: selfActive || childActive,
      children,
    };
  });
}
```

를 아래로 교체:

```ts
// 렌더 결정을 순수 계산으로 분리(DOM 없이 테스트). 펼침 토글은 컴포넌트 상태가 보강.
export function computeNavRows(items: NavItem[], pathname: string): NavRow[] {
  return items.map((item) => {
    // 형제 중 현재 경로와 매칭되는 "가장 긴(구체적) href"만 active(D8).
    // 인덱스 자식(예: 대시보드 /leave)이 형제 하위경로(/leave/request)에서 prefix로 잡히는 충돌 방지.
    const matchLen = item.children.reduce(
      (max, c) => (isActiveHref(c.href, pathname) ? Math.max(max, c.href!.length) : max),
      0,
    );
    const children: NavChildRow[] = item.children.map((c) => ({
      key: c.key, label: c.label, href: c.href,
      active: isActiveHref(c.href, pathname) && c.href!.length === matchLen,
    }));
    const selfActive = isActiveHref(item.href, pathname);
    const childActive = children.some((c) => c.active);
    return {
      key: item.key, label: item.label, href: item.href,
      isLink: item.href != null,
      active: selfActive || childActive,
      autoExpanded: selfActive || childActive,
      children,
    };
  });
}
```

### 3. 통과 확인

```
npm test -- tests/app/nav/compute-nav-rows.test.ts
```
→ 신규 5케이스 + 기존 케이스 모두 PASS.

### 4. 커밋

```
git add "src/app/(app)/app-nav.tsx" "tests/app/nav/compute-nav-rows.test.ts"
git commit -m "fix(nav): 사이드바 자식 active를 형제 최장 매칭으로 정밀화"
```

## Acceptance Criteria

```
npm test -- tests/app/nav/compute-nav-rows.test.ts   # 신규+기존 전부 passed
npm run typecheck                                     # 에러 0
npm run lint                                          # 에러 0
```

## Cautions

- **`isActiveHref`를 바꾸지 말 것.** 이유: 부모 섹션 강조(prefix 매칭)는 의도된 동작 — 부모 `연차`는 모든 `/leave/*`에서 강조·펼침되어야 한다. 정밀화는 **자식 레벨에만** 적용.
- **기존 describe 블록을 수정/삭제하지 말 것.** 이유: 통과 중인 D5 링크/토글 테스트는 본 변경과 무관(surgical). 새 블록만 추가.
- `matchLen`은 0에서 시작 — 매칭 자식이 없으면 어떤 자식도 active 아님(단락 평가로 `c.href!`는 null일 때 평가되지 않음).
