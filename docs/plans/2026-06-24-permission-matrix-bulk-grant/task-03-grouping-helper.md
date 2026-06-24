# Task 03 — 그룹화 헬퍼 (순수 함수 + 테스트)

**Purpose:** 권한 목록을 resource 첫 세그먼트로 묶어 그룹 순서대로 반환하는 순수 함수 `groupPermissions`를 추가한다(매트릭스 UI가 사용). UI에서 분리해 단위 테스트 가능하게 한다.

## Files

- Create: `src/app/(app)/admin/roles/_components/grouping.ts` — 순수 그룹화 헬퍼.
- Test: `tests/app/admin/roles/grouping.test.ts` — 신규.

## Prep

- Spec §D3.
- §Shared Contracts: "그룹화 헬퍼" 블록(이 태스크가 그 코드의 출처다).
- 테스트는 route group 소스를 `@/app/(app)/...` 별칭으로 import한다(선례: `tests/app/admin/users/labels.test.ts`가 `@/app/(app)/admin/users/_components/labels`를 import).

## Deps

없음(순수 함수 — `groups`를 인자로 받으므로 catalog 상수에 의존하지 않는다).

## Steps

### 1. 실패 테스트 작성 (`tests/app/admin/roles/grouping.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { groupPermissions } from "@/app/(app)/admin/roles/_components/grouping";

const GROUPS = [
  { key: "dashboard", label: "대시보드" },
  { key: "calendar", label: "캘린더" },
  { key: "workflows", label: "업무" },
  { key: "leave", label: "연차" },
  { key: "admin", label: "관리" },
  { key: "integrations", label: "연동" },
];

describe("groupPermissions", () => {
  it("첫 세그먼트로 묶고 groups 순서대로 반환", () => {
    const perms = [
      { id: "1", resource: "admin.users", action: "view" },
      { id: "2", resource: "calendar.work", action: "view" },
      { id: "3", resource: "dashboard", action: "view" },
      { id: "4", resource: "calendar.leave", action: "view" },
    ];
    const out = groupPermissions(perms, GROUPS);
    expect(out.map((g) => g.key)).toEqual(["dashboard", "calendar", "admin"]);
    const cal = out.find((g) => g.key === "calendar")!;
    expect(cal.permissions.map((p) => p.id)).toEqual(["2", "4"]); // 입력 순서 유지
    expect(cal.label).toBe("캘린더");
  });

  it("빈 그룹은 제외한다", () => {
    const out = groupPermissions([{ id: "1", resource: "leave.request", action: "view" }], GROUPS);
    expect(out.map((g) => g.key)).toEqual(["leave"]);
  });

  it("정의에 없는 세그먼트는 말미에 자체 그룹(label=세그먼트)", () => {
    const out = groupPermissions(
      [
        { id: "1", resource: "admin.users", action: "view" },
        { id: "2", resource: "mystery.thing", action: "view" },
      ],
      GROUPS,
    );
    expect(out.map((g) => g.key)).toEqual(["admin", "mystery"]);
    expect(out.find((g) => g.key === "mystery")!.label).toBe("mystery");
  });
});
```

### 2. 테스트 실행 (FAIL 예상 — 모듈 없음)

```bash
npm test -- grouping
```

### 3. 헬퍼 구현 (`src/app/(app)/admin/roles/_components/grouping.ts`)

```ts
export interface GroupDef {
  key: string;
  label: string;
}
export interface PermissionLite {
  id: string;
  resource: string;
  action: string;
}
export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionLite[];
}

// permissions를 resource 첫 세그먼트(`.` 앞)로 묶어 groups 순서대로 반환한다.
// - 빈 그룹은 제외. - groups에 없는 세그먼트는 말미에 자체 그룹(label=세그먼트)으로 덧붙여 누락을 방지.
// - 그룹 내부는 입력 순서를 유지(호출부가 resource·action 정렬된 목록을 넘긴다).
export function groupPermissions(
  permissions: PermissionLite[],
  groups: readonly GroupDef[],
): PermissionGroup[] {
  const segOf = (resource: string) => resource.split(".")[0];
  const byKey = new Map<string, PermissionLite[]>();
  const seenOrder: string[] = [];
  for (const p of permissions) {
    const k = segOf(p.resource);
    if (!byKey.has(k)) {
      byKey.set(k, []);
      seenOrder.push(k);
    }
    byKey.get(k)!.push(p);
  }
  const defined = new Set(groups.map((g) => g.key));
  const result: PermissionGroup[] = [];
  // 1) 정의된 그룹 순서대로(존재하는 것만)
  for (const g of groups) {
    const perms = byKey.get(g.key);
    if (perms && perms.length) result.push({ key: g.key, label: g.label, permissions: perms });
  }
  // 2) 정의에 없는 세그먼트는 등장 순서대로 말미에(label=키)
  for (const k of seenOrder) {
    if (!defined.has(k)) result.push({ key: k, label: k, permissions: byKey.get(k)! });
  }
  return result;
}
```

### 4. 테스트 실행 (PASS 예상)

```bash
npm test -- grouping
```

### 5. 커밋

```bash
git add "src/app/(app)/admin/roles/_components/grouping.ts" tests/app/admin/roles/grouping.test.ts
git commit -m "feat(roles): 권한 그룹화 순수 헬퍼(groupPermissions)"
```

## Acceptance Criteria

```bash
npm test -- grouping             # 3 passed
npm run typecheck                # 통과
npm run lint                     # 통과
```

- `groupPermissions`가 빈 그룹을 빼고 `groups` 순서대로 반환하며, 미정의 세그먼트를 말미에 둔다.

## Cautions

- **`groupPermissions`에 catalog 상수를 직접 import하지 말 것. 이유:** `groups`를 인자로 받는 순수 함수여야 테스트가 자체 fixture로 검증하고, 클라이언트 컴포넌트가 props로 받은 그룹 정의를 그대로 넘길 수 있다(서버→클라 단방향).
- **그룹 내부 정렬을 새로 하지 말 것. 이유:** 호출부(`getMatrix`)가 이미 `resource`·`action` 오름차순으로 넘긴다 — 입력 순서 보존이면 충분.
