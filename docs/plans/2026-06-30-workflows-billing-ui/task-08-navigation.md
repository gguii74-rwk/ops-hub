# Task 08 — 네비게이션 "대금청구 설정" 등록 (D8)

사이드바 `업무`(workflows) 하위에 "대금청구 설정"을 추가한다. `workflows`가 현재 leaf라 자식을 추가하면 부모 헤더의 `targetHref`가 첫 자식으로 바뀌므로(`computeNavRows`), **leave 패턴대로 index 자식 "업무 목록"(/workflows)을 첫 자식으로 함께 추가**해 업무 목록이 계속 도달 가능하게 한다.

## Files

- Modify: `src/kernel/access/catalog.ts` — `NAV`의 `workflows` 엔트리에 `children` 추가
- Modify (test): `tests/kernel/access/nav-catalog.test.ts` — workflows 자식 구조 잠금
- Modify (test): `tests/app/nav/compute-nav-rows.test.ts` — workflows targetHref 회귀 가드

## Prep

- 엔트리포인트 §SC-9(권한) 숙지. seed.ts는 `NAV`(`NAV_CATALOG`)를 그대로 소비 → catalog만 바꾸면 `db:seed`가 create-if-absent로 신규 자식만 등록(기존 `workflows` row 보존). 코드 변경은 catalog 1곳.
- 배경(검증된 동작): `computeNavRows`는 부모 `targetHref = item.children[0]?.href ?? item.href`. leave가 같은 이유로 index 자식 `leave-dashboard`(/leave)를 둔다. **권한 필터는 서버(selectVisibleNav)가 먼저** 적용 → `item.children[0]`은 첫 *보이는* 자식.
- pm은 `["*"]`로 `workflows.weekly:view`·`workflows.billing:configure` 모두 보유 → 두 자식 다 보임 → targetHref=/workflows(첫 자식). 비-billing(weekly:view만)은 "업무 목록"만 보임 → targetHref=/workflows. 즉 항상 업무 목록 도달.

## Deps

없음. (단 설정 페이지 라우트는 task-04에서 생성됨 — nav href가 실제로 열리려면 task-04 필요하나, nav 등록 자체는 독립.)

## TDD steps

### Step 1 — catalog 구조 테스트 추가 (RED)

`tests/kernel/access/nav-catalog.test.ts`의 `describe("NAV 카탈로그 트리 구조")` 안에 추가:

```ts
  it("업무(workflows) 자식 2개 — 업무 목록(index)·대금청구 설정", () => {
    const wf = byKey(NAV, "workflows");
    expect(wf.href).toBe("/workflows");
    expect(wf.permission).toBe("workflows.weekly:view");
    expect((wf.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["workflows-list", "/workflows", "workflows.weekly:view"],
      ["workflows-billing-settings", "/workflows/billing/settings", "workflows.billing:configure"],
    ]);
  });
```

`tests/app/nav/compute-nav-rows.test.ts`의 `describe("computeNavRows ...")` 안에 추가(업무 목록 index가 targetHref를 보존하는지 — 회귀 가드):

```ts
  it("업무: index 자식 '업무 목록'이 있어 부모 클릭은 /workflows(설정으로 점프 안 함)", () => {
    const wf: NavItem[] = [
      { key: "workflows", label: "업무", href: "/workflows", children: [
        leaf("workflows-list", "/workflows"),
        leaf("workflows-billing-settings", "/workflows/billing/settings"),
      ] },
    ];
    expect(computeNavRows(wf, "/dashboard")[0].targetHref).toBe("/workflows");
  });
```

Run: `npm test -- tests/kernel/access/nav-catalog.test.ts tests/app/nav/compute-nav-rows.test.ts` → **FAIL**(workflows에 children 없음).

### Step 2 — catalog.ts NAV에 workflows 자식 추가

`src/kernel/access/catalog.ts`의 `NAV` 배열에서 `workflows` 한 줄을 children 포함 객체로 교체:

```ts
  {
    key: "workflows", label: "업무", href: "/workflows", permission: "workflows.weekly:view",
    children: [
      // index 자식: 부모(업무) 클릭 시 업무 목록으로(leave-dashboard 패턴). 자식 추가로 부모가 accordion이 되어도 목록 도달 보존.
      { key: "workflows-list", label: "업무 목록", href: "/workflows", permission: "workflows.weekly:view" },
      { key: "workflows-billing-settings", label: "대금청구 설정", href: "/workflows/billing/settings", permission: "workflows.billing:configure" },
    ],
  },
```

(나머지 NAV 엔트리·`as const`는 그대로.)

Run: `npm test -- tests/kernel/access/nav-catalog.test.ts tests/app/nav/compute-nav-rows.test.ts` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/kernel/access/nav-catalog.test.ts tests/app/nav/compute-nav-rows.test.ts` → PASS.
- `npm run typecheck` / `npm run lint` → green.
- 전체 `npm test` → 회귀 0(특히 `navigation-catalog.test.ts` "기존 5개 대메뉴 보존" = top-level keys 불변 — workflows에 자식만 추가, 새 top-level 없음).
- (배포 검증, 수동) `db:seed`가 기존 DB의 `workflows`(parentId null) 아래 `workflows-list`·`workflows-billing-settings`를 create-if-absent로 등록. pm 로그인 시 사이드바 업무 → [업무 목록, 대금청구 설정] 노출, 업무 헤더 클릭 = /workflows.

## Cautions

- **Don't** "업무 목록" index 자식을 빼지 말 것 — 빼면 pm/owner는 업무 헤더 클릭이 /workflows/billing/settings로 점프하고 작업 목록(/workflows)이 사이드바에서 도달 불가가 된다(`targetHref=첫 자식`). leave-dashboard와 동일한 index-child 패턴.
- **Don't** `workflows-billing-settings` permission을 `:view`로 두지 말 것 — D8은 `workflows.billing:configure`. (configure 보유 role은 :view도 보유 — pm `["*"]`, 설정 페이지 진입 GET 통과.)
- **Don't** 새 top-level 메뉴를 만들지 말 것 — workflows 하위. `navigation-catalog.test.ts`의 top-level 5개 불변식 유지.
- **Don't** seed.ts를 손대지 말 것 — `NAV_CATALOG` 소비라 catalog 변경만으로 충분. 기존 `workflows` row는 편집 보존(skip).
