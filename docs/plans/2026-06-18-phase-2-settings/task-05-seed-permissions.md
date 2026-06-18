# Task 05 — seed 보강: workflows configure 권한 + 정합성 테스트

**Purpose:** 설정 카탈로그가 참조하는 `workflows.weekly:configure`·`workflows.billing:configure` 권한이 현재 seed에 없어 fail-closed 된다(Codex Finding 5, 검증됨). seed에 추가하고, "카탈로그 permission ⊆ seed 권한"을 테스트로 고정한다.

## Files

- Create: `prisma/seed-permissions.ts` — `EXTRA_PERMISSIONS` 분리(side-effect 없음, seed·test 공유).
- Modify: `prisma/seed.ts` — `EXTRA_PERMISSIONS`를 inline 제거하고 `./seed-permissions`에서 import + 2개 항목 추가됨.
- Test: `tests/kernel/settings/seed-permissions.test.ts` — 카탈로그 permission이 seed 권한 집합에 모두 존재.

## Prep

- entrypoint §SC-7, spec §10.
- 현재 `prisma/seed.ts`의 `EXTRA_PERMISSIONS`(L12–24), `VIEW_RESOURCES`(=`RESOURCES`). `admin.settings:view`는 VIEW_RESOURCES로 이미 생성됨(확인).

## Deps

- Task 01(settings `CATALOG`).

## TDD steps

### 1. 실패 테스트 작성 — `tests/kernel/settings/seed-permissions.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { RESOURCES } from "@/kernel/access/catalog";
import { CATALOG } from "@/kernel/settings/catalog";
import { EXTRA_PERMISSIONS } from "../../../prisma/seed-permissions";

// seed가 만드는 권한 키 집합 재구성: 모든 RESOURCES:view + EXTRA_PERMISSIONS.
function seededKeys(): Set<string> {
  const s = new Set<string>();
  for (const r of RESOURCES) s.add(`${r}:view`);
  for (const [resource, action] of EXTRA_PERMISSIONS) s.add(`${resource}:${action}`);
  return s;
}

describe("settings 카탈로그 권한이 seed에 존재", () => {
  it("모든 카탈로그 permission(resource:action)이 seed 권한 집합에 포함", () => {
    const seeded = seededKeys();
    const missing = CATALOG.map((e) => `${e.permission.resource}:${e.permission.action}`).filter(
      (k) => !seeded.has(k),
    );
    expect(missing).toEqual([]);
  });

  it("workflows configure 권한이 명시적으로 추가됨", () => {
    const keys = new Set(EXTRA_PERMISSIONS.map(([r, a]) => `${r}:${a}`));
    expect(keys.has("workflows.weekly:configure")).toBe(true);
    expect(keys.has("workflows.billing:configure")).toBe(true);
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- seed-permissions
```

기대: `Cannot find module '../../../prisma/seed-permissions'`.

### 3. 구현 — `prisma/seed-permissions.ts`

> 현재 seed.ts L12–24의 배열을 그대로 옮기고 **2개 항목 추가**(`workflows.weekly:configure`, `workflows.billing:configure`).

```ts
// 설정 도메인 등 view 외 권한 정의. side-effect 없음(seed·test 공유).
export const EXTRA_PERMISSIONS: Array<[string, string]> = [
  ["workflows.weekly", "create"], ["workflows.weekly", "generate"], ["workflows.weekly", "send"],
  ["workflows.weekly", "configure"],
  ["workflows.billing", "create"], ["workflows.billing", "send"],
  ["workflows.billing", "configure"],
  ["workflows.notification", "create"], ["workflows.notification", "send"],
  ["leave.request", "create"],
  ["leave.approval", "approve"],
  ["leave.allocation", "configure"],
  ["admin.users", "update"],
  ["admin.settings", "configure"],
  ["integrations.google", "configure"],
  ["integrations.smtp", "configure"],
  ["integrations.templates", "configure"],
];
```

### 4. 구현 — `prisma/seed.ts` 수정

inline `EXTRA_PERMISSIONS` 정의(L12–24)를 삭제하고 import로 대체:

```ts
import { ACCESS_ROLE_KEYS, NAV as NAV_CATALOG, RESOURCES } from "../src/kernel/access/catalog";
import { EXTRA_PERMISSIONS } from "./seed-permissions";
```

(나머지 로직 불변. `EXTRA_PERMISSIONS`는 그대로 `defs` 구성에서 사용됨.)

role 매핑은 변경 없음: `pm: ["*"]`가 새 권한을 포함하고, 시드 admin은 OWNER systemRole로 전부 허용된다. 비-PM 역할에 설정 configure를 여는 것은 후속 결정으로 둔다.

### 5. 실행 → PASS

```bash
npm test -- seed-permissions
```

기대: 2 테스트 통과.

### 6. typecheck/lint + (DB 있으면) seed 실행 스모크

```bash
npm run typecheck && npm run lint
# 로컬 Postgres + SEED_ADMIN_PASSWORD 설정 시:
# npm run prisma:generate && npx tsx prisma/seed.ts  → "permissions=NN" 로그, 오류 없음
```

### 7. 커밋

```bash
git add prisma/seed-permissions.ts prisma/seed.ts tests/kernel/settings/seed-permissions.test.ts
git commit -m "Seed workflows.*:configure permissions for settings catalog"
```

## Acceptance Criteria

- `npm test -- seed-permissions` → 2 PASS(특히 `missing` 빈 배열).
- `npm run typecheck` / `npm run lint` → 에러 0.
- `prisma/seed.ts`는 `EXTRA_PERMISSIONS`를 `./seed-permissions`에서 import(inline 정의 부재).

## Cautions

- **`prisma/seed-permissions.ts`에 side-effect(예: PrismaClient 생성·main 호출) 금지. 이유:** 테스트가 import하므로 순수 데이터 모듈이어야 한다.
- **테스트는 seed.ts를 직접 import하지 말 것. 이유:** seed.ts는 import 시 `main()`을 실행해 DB에 접속·종료한다(테스트 오염).
- **role 매트릭스에서 기존 키를 제거하지 말 것. 이유:** 본 task는 권한 추가만. seed의 delete-then-insert 재삽입 로직(F1) 동작을 바꾸지 않는다.
