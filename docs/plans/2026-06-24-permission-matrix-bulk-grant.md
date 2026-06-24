# 권한 매트릭스 묶음 부여·역할 표시 개선 — 구현 계획

- Spec: `docs/specs/2026-06-24-permission-matrix-bulk-grant-design.md`
- Goal: 권한 매트릭스에서 역할 열 표시명·순서를 바꾸고, 도메인 그룹 단위로 한 역할에 권한을 묶어서 부여(ALLOW/DENY/해제)할 수 있게 한다(개별 셀 편집 유지).
- Architecture: 기존 `Route → Service → Repository → Prisma` 계층 유지. 묶음은 새 서비스 `setRoleCellsBulk`가 단건 경로의 per-cell 가드(`assertCellAllowed`)와 `repository.setCell`을 권한마다 재사용해 skip-and-report로 처리. 표시 순서·그룹 정의는 `kernel/access/catalog.ts` 상수, 그룹화 렌더는 클라이언트 순수 헬퍼.
- Tech Stack: Next.js App Router, TypeScript, Prisma(PostgreSQL), zod, vitest.

> **For agentic workers — execution contract (MUST):** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-24-permission-matrix-bulk-grant/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

2개 이상 태스크가 참조하는 타입·시그니처·상수. 태스크 파일은 여기를 가리키고 재인라인하지 않는다.

### 상수 (`src/kernel/access/catalog.ts` — Task 01에서 추가)

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

### 서비스 시그니처 (`src/modules/admin/roles/services/index.ts`)

```ts
// 단건/묶음이 공유하는 per-permission 가드. 통과 시 정규화된 scope 반환, 위반 시 ForbiddenError(사유 포함).
export function assertCellAllowed(
  roleKey: string,
  perm: { resource: string; action: string },
  effect: "none" | "ALLOW" | "DENY",
  scope: string,
): string;

export interface BulkResult {
  applied: number;
  skipped: Array<{ key: string; reason: string }>;
}

// 묶음 부여 — prefix 매칭 권한을 순회하며 per-cell 가드+setCell 재사용, 차단 셀은 skip-and-report.
export function setRoleCellsBulk(
  actorId: string, roleId: string, resourcePrefix: string, effect: "none" | "ALLOW" | "DENY",
): Promise<BulkResult>;
```

### 검증 스키마 (`src/modules/admin/roles/validations/index.ts`)

```ts
export const bulkSetSchema = z.object({
  resourcePrefix: z.string().refine(
    (v) => (PERMISSION_GROUP_KEYS as readonly string[]).includes(v),
    "unknown group",
  ),
  effect: z.enum(["none", "ALLOW", "DENY"]),
});
export type BulkSetInput = z.infer<typeof bulkSetSchema>;
```

### 묶음 라우트 계약 (`PUT /api/admin/roles/[roleId]/permissions/bulk`)

```jsonc
// request body
{ "resourcePrefix": "admin", "effect": "ALLOW" }   // effect ∈ "ALLOW" | "DENY" | "none"
// 200 response
{ "applied": 6, "skipped": [{ "key": "admin.roles:configure", "reason": "admin.roles:configure는 …(OWNER 전용)." }] }
// 401 미인증 / 400 invalid input / 403 ForbiddenError(message) / 500 서버 오류
```

### 그룹화 헬퍼 (`src/app/(app)/admin/roles/_components/grouping.ts` — Task 03에서 신설)

```ts
export interface GroupDef { key: string; label: string; }
export interface PermissionLite { id: string; resource: string; action: string; }
export interface PermissionGroup { key: string; label: string; permissions: PermissionLite[]; }
// permissions를 resource 첫 세그먼트로 묶어 groups 순서대로 반환(빈 그룹 제외, 미정의 세그먼트는 말미).
export function groupPermissions(
  permissions: PermissionLite[], groups: readonly GroupDef[],
): PermissionGroup[];
```

### MatrixEditor props 변경 (`_components/matrix-editor.tsx`)

기존 props에 `groups: GroupDef[]` 추가. 나머지(`matrix`, `scopeOptions`, `canConfigure`)는 유지.

## 불변식 (모든 태스크가 깨면 안 됨)

- 단건 `setRoleCell`의 동작·가드·에러 메시지는 **회귀 없이 동일**(기존 `tests/modules/admin/roles/matrix-service.test.ts` green 유지).
- `setCell`(repository)의 advisory lock·in-tx OWNER 재확인·audit는 변경 없음(기존 `matrix-repo.test.ts` green 유지).
- 묶음도 동일 키(`admin.roles:configure`)를 검사하고 비-OWNER를 fail-closed로 거부.
- DENY/해제는 권한 제거 방향 → critical 차단 가드 비적용(단건과 동일).

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 역할 표시 순서·이름 + 그룹 상수 (catalog/getMatrix/seed) | [ ] | [task-01](2026-06-24-permission-matrix-bulk-grant/task-01-display-and-constants.md) | — | |
| 02 | 묶음 백엔드 (assertCellAllowed 추출·setRoleCellsBulk·route·validation) | [ ] | [task-02](2026-06-24-permission-matrix-bulk-grant/task-02-bulk-backend.md) | 01 | |
| 03 | 그룹화 헬퍼 (순수 함수 + 테스트) | [ ] | [task-03](2026-06-24-permission-matrix-bulk-grant/task-03-grouping-helper.md) | — | |
| 04 | 매트릭스 UI (접기/펼치기·묶음 셀렉트·요약) + page 연결 | [ ] | [task-04](2026-06-24-permission-matrix-bulk-grant/task-04-matrix-ui.md) | 01,02,03 | |
