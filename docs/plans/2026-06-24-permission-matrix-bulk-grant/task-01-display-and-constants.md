# Task 01 — 역할 표시 순서·이름 + 그룹 상수

**Purpose:** 역할 열 표시 순서(`ROLE_DISPLAY_ORDER`)·묶음 그룹(`PERMISSION_GROUPS`) 상수를 추가하고, `getMatrix`가 표시 순서로 역할을 정렬하게 하며, 시드의 역할 표시명 3건을 변경한다.

## Files

- Modify: `src/kernel/access/catalog.ts` — 파일 끝에 `PERMISSION_GROUPS`/`PERMISSION_GROUP_KEYS`/`ROLE_DISPLAY_ORDER` 추가.
- Modify: `src/modules/admin/roles/repositories/index.ts` — `getMatrix` 정렬 변경(`setCell`은 손대지 않음).
- Modify: `prisma/seed.ts` — `ROLE_NAMES` 3건 변경.
- Test: `tests/modules/admin/roles/matrix-getmatrix.test.ts` — 신규(정렬 검증).

## Prep

- Spec §D1, §D2, §D3.
- §Shared Contracts의 "상수" 블록(이 태스크가 그 코드의 출처다).
- 기존 `getMatrix`는 `orderBy: { key: "asc" }`로 역할을 반환한다(repositories/index.ts).

## Deps

없음.

## Steps

### 1. 상수 추가 (`src/kernel/access/catalog.ts`)

파일 **맨 끝**에 아래를 추가한다(기존 `NAV` export 뒤). 기존 내용은 변경하지 않는다.

```ts

// 권한 매트릭스 묶음 부여·표시 그룹 — resource 첫 세그먼트 단위(D3). 순서=표시 순서(메뉴와 동일).
export const PERMISSION_GROUPS = [
  { key: "dashboard", label: "대시보드" },
  { key: "calendar", label: "캘린더" },
  { key: "workflows", label: "업무" },
  { key: "leave", label: "연차" },
  { key: "admin", label: "관리" },
  { key: "integrations", label: "연동" },
] as const;
export const PERMISSION_GROUP_KEYS = PERMISSION_GROUPS.map((g) => g.key);

// 권한 매트릭스 역할 열 표시 순서(UX 전용, D1). 시드·타입용 ACCESS_ROLE_KEYS와 분리.
export const ROLE_DISPLAY_ORDER = [
  "admin", "pm", "regular-developer",
  "contractor-developer", "contractor-content", "contractor-civil-response",
] as const;
```

### 2. 실패 테스트 작성 (`tests/modules/admin/roles/matrix-getmatrix.test.ts`)

신규 파일. 기존 `matrix-repo.test.ts`의 hoisted 모크를 건드리지 않도록 별도 파일로 둔다(`getMatrix`는 `prisma.*.findMany`를 직접 호출 — tx 모크와 무관).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    accessRole: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { getMatrix } from "@/modules/admin/roles/repositories";

beforeEach(() => {
  vi.clearAllMocks();
  h.db.permission.findMany.mockResolvedValue([]);
  h.db.rolePermission.findMany.mockResolvedValue([]);
});

describe("getMatrix 역할 표시 순서(D1)", () => {
  it("DB가 임의 순서로 줘도 ROLE_DISPLAY_ORDER 순서로 반환", async () => {
    h.db.accessRole.findMany.mockResolvedValue([
      { id: "1", key: "pm", name: "PM" },
      { id: "2", key: "contractor-civil-response", name: "민원응대" },
      { id: "3", key: "admin", name: "관리자" },
      { id: "4", key: "regular-developer", name: "정규 개발자" },
      { id: "5", key: "contractor-content", name: "콘텐츠관리" },
      { id: "6", key: "contractor-developer", name: "외주 개발자" },
    ]);
    const m = await getMatrix();
    expect(m.roles.map((r) => r.key)).toEqual([
      "admin", "pm", "regular-developer",
      "contractor-developer", "contractor-content", "contractor-civil-response",
    ]);
  });

  it("미지의 키는 말미로(안정 정렬)", async () => {
    h.db.accessRole.findMany.mockResolvedValue([
      { id: "x", key: "mystery", name: "?" },
      { id: "1", key: "pm", name: "PM" },
      { id: "3", key: "admin", name: "관리자" },
    ]);
    const m = await getMatrix();
    expect(m.roles.map((r) => r.key)).toEqual(["admin", "pm", "mystery"]);
  });
});
```

### 3. 테스트 실행 (FAIL 예상)

```bash
npm test -- matrix-getmatrix
```

현 `getMatrix`는 `key` 알파벳순(admin, contractor-civil-response, …, pm, regular-developer)을 반환하므로 첫 테스트 실패.

### 4. `getMatrix` 정렬 변경 (`src/modules/admin/roles/repositories/index.ts`)

파일 상단 import에 `ROLE_DISPLAY_ORDER`를 추가하고, `getMatrix`를 아래로 교체한다. **`setCell` 및 그 위 주석/상수(`ROLE_MATRIX_LOCK_NS`)는 변경하지 않는다.**

import 추가(기존 import 블록 아래):

```ts
import { ROLE_DISPLAY_ORDER } from "@/kernel/access/catalog";
```

`getMatrix` 교체:

```ts
export async function getMatrix(): Promise<MatrixData> {
  const [rolesRaw, permissions, rules] = await Promise.all([
    prisma.accessRole.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, name: true } }),
    prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }], select: { id: true, resource: true, action: true } }),
    prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true, effect: true, scope: true } }),
  ]);
  // 표시 순서(D1)로 역할 정렬. 목록에 없는 키는 말미(999) — Array.sort 안정성으로 그들끼리는 key-asc 유지.
  const orderIdx = new Map<string, number>(ROLE_DISPLAY_ORDER.map((k, i) => [k, i]));
  const roles = [...rolesRaw].sort((a, b) => (orderIdx.get(a.key) ?? 999) - (orderIdx.get(b.key) ?? 999));
  return { roles, permissions, rules };
}
```

### 5. 테스트 실행 (PASS 예상)

```bash
npm test -- matrix-getmatrix
```

### 6. 시드 표시명 변경 (`prisma/seed.ts`)

`ROLE_NAMES` 객체를 아래로 교체한다(키는 그대로, 값 3건 변경).

변경 전:
```ts
const ROLE_NAMES: Record<string, string> = {
  pm: "PM",
  admin: "사용자 관리자",
  "regular-developer": "정규 개발자",
  "contractor-developer": "외주 개발자",
  "contractor-content": "외주 컨텐츠관리",
  "contractor-civil-response": "외주 민원응대",
};
```

변경 후:
```ts
const ROLE_NAMES: Record<string, string> = {
  pm: "PM",
  admin: "관리자",
  "regular-developer": "정규 개발자",
  "contractor-developer": "외주 개발자",
  "contractor-content": "콘텐츠관리",
  "contractor-civil-response": "민원응대",
};
```

### 7. 커밋

```bash
git add src/kernel/access/catalog.ts src/modules/admin/roles/repositories/index.ts prisma/seed.ts tests/modules/admin/roles/matrix-getmatrix.test.ts
git commit -m "feat(roles): 역할 열 표시 순서·이름 변경 + 묶음 그룹 상수"
```

## Acceptance Criteria

```bash
npm test -- matrix-getmatrix     # 2 passed
npm test -- matrix-repo          # 기존 setCell 테스트 green (회귀 없음)
npm run typecheck                # 통과
npm run lint                     # 통과
```

- `getMatrix().roles`가 `admin → pm → regular-developer → contractor-developer → contractor-content → contractor-civil-response` 순서.
- `prisma/seed.ts`의 `ROLE_NAMES`가 관리자/콘텐츠관리/민원응대로 변경됨.

## Cautions

- **`setCell`과 `ROLE_MATRIX_LOCK_NS` 주석을 건드리지 말 것. 이유:** 그 동시성·감사 로직은 PR #15에서 적대검증으로 굳힌 부분이라 회귀 위험이 크다. 이 태스크는 `getMatrix` 정렬만 바꾼다.
- **`ACCESS_ROLE_KEYS`를 재정렬하지 말 것. 이유:** 시드 루프·타입 union의 의미 상수이며, 표시 순서는 별도 `ROLE_DISPLAY_ORDER`로 분리하는 것이 spec(D1) 결정이다.
- **표시명 변경은 재시드 전까지 기존 DB에 반영되지 않음(의도).** 이 태스크는 코드만 바꾼다 — 배포 시 `npm run db:seed`가 upsert `update:{name}`로 반영한다.
