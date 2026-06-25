# task-04 — 사이드바 "설정" 메뉴 노출(NAV)

설정 화면(`/admin/settings`)은 존재·동작하지만 사이드바 "관리" 트리에 항목이 누락돼 URL 직접 입력으로만 닿는다. `NAV` 부트스트랩 트리의 `admin` children 끝에 "설정"을 추가한다.

## Files

- Modify: `src/kernel/access/catalog.ts` — `NAV`의 `admin.children` 끝에 `admin-settings`.
- Test: `tests/kernel/access/nav-catalog.test.ts` — admin 자식 4→5 `toEqual` 갱신.

## Prep

- 읽기: spec §5.
- 기존 `admin.children`: `admin-users`·`admin-teams`·`admin-roles`·`admin-navigation`(4개). `admin`은 top-level(href `/admin`).
- 권한 `admin.settings:view`는 RESOURCES(`admin.settings`)×ACTIONS(`view`)에 이미 존재 — 신규 권한 없음.
- `seedNavigation`은 create-if-absent → 재시드 시 기존 트리에 신규 자식만 추가(배포 시 `npm run db:seed` 필요).

## Deps

없음.

## TDD steps

### Step 1 — 테스트 갱신(실패 확인)

`tests/kernel/access/nav-catalog.test.ts`의 "관리(admin) 자식 4개" 테스트를 5개로 갱신:

기존:
```ts
  it("관리(admin) 자식 4개 — 사용자 관리·팀 관리·권한 매트릭스·메뉴 관리 순서", () => {
    const admin = byKey(NAV, "admin");
    expect((admin.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["admin-users", "/admin/users", "admin.users:view"],
      ["admin-teams", "/admin/teams", "admin.teams:view"],
      ["admin-roles", "/admin/roles", "admin.roles:view"],
      ["admin-navigation", "/admin/navigation", "admin.navigation:view"],
    ]);
  });
```
→
```ts
  it("관리(admin) 자식 5개 — 사용자·팀·권한·메뉴·설정 순서", () => {
    const admin = byKey(NAV, "admin");
    expect((admin.children ?? []).map((c) => [c.key, c.href, c.permission])).toEqual([
      ["admin-users", "/admin/users", "admin.users:view"],
      ["admin-teams", "/admin/teams", "admin.teams:view"],
      ["admin-roles", "/admin/roles", "admin.roles:view"],
      ["admin-navigation", "/admin/navigation", "admin.navigation:view"],
      ["admin-settings", "/admin/settings", "admin.settings:view"],
    ]);
  });
```

실행(FAIL 기대 — NAV에 admin-settings 없음):
```bash
npx vitest run tests/kernel/access/nav-catalog.test.ts
```

### Step 2 — NAV에 admin-settings 추가

`src/kernel/access/catalog.ts`의 `admin` children 배열 끝(`admin-navigation` 항목 다음)에 추가:

```ts
      { key: "admin-navigation", label: "메뉴 관리", href: "/admin/navigation", permission: "admin.navigation:view" },
      { key: "admin-settings", label: "설정", href: "/admin/settings", permission: "admin.settings:view" },
```

실행(PASS 기대):
```bash
npx vitest run tests/kernel/access/nav-catalog.test.ts
```

### Step 3 — 검증 + 커밋

```bash
npm run typecheck
npm run lint
npm test
```

`tests/kernel/access/navigation-catalog.test.ts`(별도 파일)는 `.find()`만 써서 영향 없음 — 그린 유지 확인. 전부 통과하면 커밋:

```bash
git add src/kernel/access/catalog.ts tests/kernel/access/nav-catalog.test.ts
git commit -m "feat(nav): 관리 트리에 설정 메뉴 노출"
```

## Acceptance Criteria

- `npx vitest run tests/kernel/access/nav-catalog.test.ts` — admin 자식 5개(설정 포함) 통과.
- `npx vitest run tests/kernel/access/navigation-catalog.test.ts` — 회귀 없음(메뉴 관리 자식 `.find` 테스트 그린).
- "모든 NAV 권한 키가 카탈로그에 존재" walk 테스트 통과(`admin.settings`·`view` 둘 다 카탈로그에 존재).
- `npm run typecheck` / `npm run lint` / `npm test` — 전체 그린.

## Cautions

- **신규 권한을 만들지 마라.** `admin.settings:view`는 기존 RESOURCES×ACTIONS에 이미 존재. 새 resource/action 추가는 비목표.
- **DB는 코드 변경만으로 갱신되지 않는다.** `NAV`는 부트스트랩 시드 — 진실원은 DB(D3). 배포 시 `npm run db:seed`로 `admin-settings`를 등록해야 사이드바에 보인다. `sortOrder`는 형제 인덱스 기반이라 마지막에 붙는다(이후 메뉴 관리 화면에서 재정렬 가능).
- `admin`은 top-level이므로 자식 추가가 depth-2(자식의 자식 없음) 규칙을 위반하지 않는다.
