# task-06 — validations·errors·href·도메인 타입

**목적:** 신규 모듈 `modules/admin/navigation`의 입력 검증(zod)·에러 클래스·`href` 검증(D7)·도메인 타입을 정의한다. 이후 repo/service/api/ui가 공유하는 계약 코어.

## Files

- **Create:** `src/modules/admin/navigation/errors.ts`(SC-9)
- **Create:** `src/modules/admin/navigation/href.ts`(SC-4)
- **Create:** `src/modules/admin/navigation/validations/index.ts`(SC-6 zod·타입)
- **Create (test):** `tests/modules/admin/navigation/validations.test.ts`

## Prep

- 스펙 §8(쓰기 경로 검증)·§10(엣지)·결정 D6/D7/D8/D17.
- 엔트리포인트 §Shared Contracts **SC-4**(href)·**SC-6**(도메인 타입)·**SC-7**(낙관락)·**SC-9**(에러).
- 기존 출처: `src/modules/admin/users/validations/index.ts`(zod·`updateUserBodySchema.extend` 패턴), `src/kernel/optimistic.ts`(`expectedUpdatedAt`), `src/modules/admin/users/errors.ts`(에러 클래스 패턴).

## Deps

없음.

## Cautions

- **`key`는 입력 스키마에 넣지 말 것**(D17) — 서버 생성·불변. create/update 어디에도 `key` 필드 없음.
- **`parentId`는 update 스키마에 넣지 말 것** — 이동은 reparent 전용 경로(SC-6/SC-8). update는 라벨·href·권한·활성만.
- **href 정규식은 SC-4 그대로**(`^/(?!/)[A-Za-z0-9/_-]*$`) — 단순화하지 말 것. 선두 `//`·스킴·백슬래시·인코딩 슬래시·공백을 전부 거부해야 외부 origin 누출이 막힌다(D7/F-1).
- `requiredPermissionId == null`은 "공개"로 **허용**(D8). 스키마에서 거부 금지.

## Step 1 — 실패 테스트: href·스키마

`tests/modules/admin/navigation/validations.test.ts` 생성:

```ts
import { describe, it, expect } from "vitest";
import { createNavSchema, updateNavSchema, reorderNavSchema, deleteNavBodySchema } from "@/modules/admin/navigation/validations";
import { HREF_PATTERN, isKnownInternalRoute } from "@/modules/admin/navigation/href";

const hrefOk = (h: string) => HREF_PATTERN.test(h);

describe("href 검증(D7/F-1)", () => {
  it("외부·오픈리다이렉트·형식위반 거부", () => {
    for (const bad of ["//host", "//evilexample", "http://x", "/\\x", "/a b", "/a\\b", "/a%2Fb", ""]) {
      expect(hrefOk(bad)).toBe(false);
    }
  });
  it("origin-relative 내부 경로 통과", () => {
    for (const ok of ["/valid/path", "/admin/navigation", "/dashboard"]) {
      expect(hrefOk(ok)).toBe(true);
    }
  });
});

describe("isKnownInternalRoute(소프트 경고)", () => {
  it("알려진 prefix는 true, 그 외 false", () => {
    expect(isKnownInternalRoute("/admin/navigation")).toBe(true);
    expect(isKnownInternalRoute("/leave")).toBe(true);
    expect(isKnownInternalRoute("/unknown/page")).toBe(false);
  });
});

describe("createNavSchema", () => {
  it("label 필수·공개(권한 null)·그룹헤더(href null) 허용", () => {
    expect(createNavSchema.safeParse({ label: "메뉴", href: null, parentId: null, requiredPermissionId: null }).success).toBe(true);
  });
  it("빈 label·외부 href 거부", () => {
    expect(createNavSchema.safeParse({ label: "", href: "/x", parentId: null, requiredPermissionId: null }).success).toBe(false);
    expect(createNavSchema.safeParse({ label: "메뉴", href: "//evil", parentId: null, requiredPermissionId: null }).success).toBe(false);
  });
  it("key 필드는 스키마가 strip(입력 불가 — D17)", () => {
    const parsed = createNavSchema.parse({ label: "메뉴", href: "/x", parentId: null, requiredPermissionId: null, key: "해킹" });
    expect(parsed).not.toHaveProperty("key");
  });
});

describe("updateNavSchema", () => {
  it("parentId는 strip(이동은 reparent 전용)", () => {
    const parsed = updateNavSchema.parse({ label: "x", parentId: "p1" });
    expect(parsed).not.toHaveProperty("parentId");
  });
});

describe("reorderNavSchema", () => {
  const AT = "2026-06-22T00:00:00.000Z";
  it("parentId(null 허용)+orderedItems(최소 1, id+updatedAt)", () => {
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [{ id: "a", updatedAt: AT }, { id: "b", updatedAt: AT }] }).success).toBe(true);
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [] }).success).toBe(false);
  });
  it("updatedAt 없는 항목 거부(P6 — 버전 토큰 필수)", () => {
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [{ id: "a" }] }).success).toBe(false);
  });
  it("중복 ID 거부(P2 — sortOrder 손상 차단)", () => {
    expect(reorderNavSchema.safeParse({ parentId: null, orderedItems: [{ id: "a", updatedAt: AT }, { id: "a", updatedAt: AT }] }).success).toBe(false);
  });
});

describe("deleteNavBodySchema(P9 — 확인 자식 집합 동반)", () => {
  const AT = "2026-06-22T00:00:00.000Z";
  it("updatedAt + confirmedChildIds(빈 배열=leaf·ID 배열 모두 허용)", () => {
    expect(deleteNavBodySchema.safeParse({ updatedAt: AT, confirmedChildIds: [] }).success).toBe(true);
    expect(deleteNavBodySchema.safeParse({ updatedAt: AT, confirmedChildIds: ["c1", "c2"] }).success).toBe(true);
  });
  it("confirmedChildIds 누락 거부(fail-closed — TOCTOU 가드 우회 차단)", () => {
    expect(deleteNavBodySchema.safeParse({ updatedAt: AT }).success).toBe(false);
  });
});
```

실행: `npm test -- navigation/validations` → **FAIL**.

## Step 2 — errors.ts

`src/modules/admin/navigation/errors.ts`:

```ts
export class NavigationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationValidationError";
  }
}

export class NavigationConflictError extends Error {
  constructor(message = "처리 중 메뉴가 변경되었습니다. 새로고침 후 다시 시도하세요.") {
    super(message);
    this.name = "NavigationConflictError";
  }
}
```

## Step 3 — href.ts

`src/modules/admin/navigation/href.ts`:

```ts
// origin-relative만 하드 허용(D7). 선두 // 금지(protocol-relative 외부링크 차단). 스킴(:)·백슬래시·
// 인코딩 슬래시(%)·공백은 문자클래스에 없어 자동 거부. 그룹 헤더는 href 없음(null) — 이 정규식은 string 전용.
export const HREF_PATTERN = /^\/(?!\/)[A-Za-z0-9/_-]*$/;

// 소프트 경고용 큐레이트 내부 라우트 prefix. 형식은 통과하나 여기에 없으면 "죽은 링크일 수 있음" 경고
// (저장은 허용 — 페이지 선출시 등록 대비 — D7). 유지 부담이 크면 형식 검증만으로 축소 가능.
export const INTERNAL_ROUTE_PREFIXES = ["/dashboard", "/calendar", "/workflows", "/leave", "/admin"] as const;

export function isKnownInternalRoute(href: string): boolean {
  return INTERNAL_ROUTE_PREFIXES.some((p) => href === p || href.startsWith(`${p}/`));
}
```

## Step 4 — validations/index.ts

`src/modules/admin/navigation/validations/index.ts`:

```ts
import { z } from "zod";
import { expectedUpdatedAt } from "@/kernel/optimistic";
import { HREF_PATTERN } from "../href";

const label = z.string().trim().min(1, "라벨은 필수입니다.").max(100);
// null = 그룹 헤더(이동 없음). string이면 origin-relative만(D7).
const href = z.union([z.null(), z.string().regex(HREF_PATTERN, "유효한 내부 경로(/로 시작)만 허용됩니다.")]);
const parentId = z.string().min(1).nullable();             // null = 대메뉴
const requiredPermissionId = z.string().min(1).nullable(); // null = 공개(D8)

// 생성: key는 입력 아님(D17 — strip). sortOrder는 서버가 형제 말미로 부여.
export const createNavSchema = z.object({
  label,
  href,
  parentId,
  requiredPermissionId,
});

// 수정: 부분 patch. parentId는 없음(이동은 reparent 전용 — strip).
export const updateNavSchema = z.object({
  label: label.optional(),
  href: href.optional(),
  requiredPermissionId: requiredPermissionId.optional(),
  isActive: z.boolean().optional(),
});

// 재정렬: 형제 묶음 전체의 새 순서 + 각 형제의 관측 updatedAt(P6 lost-update 차단).
// 중복 ID 거부(P2 — 중복이 통과하면 한 행을 두 번 갱신·다른 형제 누락으로 sortOrder 손상).
// updatedAt은 ISO로 받고 라우트가 Date로 변환(다른 변경 경로와 동일 — SC-7).
export const reorderNavSchema = z
  .object({
    parentId: z.string().min(1).nullable(),
    orderedItems: z.array(z.object({ id: z.string().min(1), updatedAt: expectedUpdatedAt })).min(1),
  })
  .refine((v) => new Set(v.orderedItems.map((i) => i.id)).size === v.orderedItems.length, {
    message: "중복된 메뉴 ID가 있습니다.",
    path: ["orderedItems"],
  });

// 이동(reparent): 대상 부모(null=대메뉴 승격). id는 라우트 param.
export const reparentNavSchema = z.object({
  newParentId: z.string().min(1).nullable(),
});

// 낙관락 body(SC-7) — 수정·이동·삭제는 updatedAt 동반.
export const updateNavBodySchema = updateNavSchema.extend({ updatedAt: expectedUpdatedAt });
export const reparentNavBodySchema = reparentNavSchema.extend({ updatedAt: expectedUpdatedAt });
// 삭제: updatedAt + 확인 시점 직속 자식 ID 집합(P9). 서비스가 현재 DB 자식 집합과 대조, 불일치 시 409
// (확인 화면 렌더 후 추가/이동된 자식이 확인 없이 cascade 삭제되는 TOCTOU 차단). leaf는 []. 누락 거부=fail-closed.
export const deleteNavBodySchema = z.object({
  updatedAt: expectedUpdatedAt,
  confirmedChildIds: z.array(z.string().min(1)),
});

export type CreateNavInput = z.infer<typeof createNavSchema>;
export type UpdateNavInput = z.infer<typeof updateNavSchema>;
export type ReparentNavInput = z.infer<typeof reparentNavSchema>;
// reorder 서비스/repo 레벨 타입 — 라우트가 orderedItems.updatedAt(ISO)을 Date로 변환해 넘긴다
// (z.infer는 updatedAt이 string이라 별도 정의 — SC-6).
export interface ReorderNavInput {
  parentId: string | null;
  orderedItems: Array<{ id: string; updatedAt: Date }>;
}
```

실행: `npm test -- navigation/validations` → **PASS**.

## Acceptance Criteria

- `npm test -- navigation/validations` → 전부 PASS.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 errors(eslint boundaries — `modules/admin/navigation`은 `@/kernel/optimistic` 의존 허용. 위반 시 boundaries 설정 확인).
