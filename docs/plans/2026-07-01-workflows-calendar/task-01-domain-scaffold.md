# Task 01 — 도메인 스캐폴딩 (enum·migration·policy·validations·ALL_KINDS·RESOURCES)

신규 client kind 2종을 실제 도메인 객체로 스캐폴딩한다: `WorkflowKind` enum + additive 마이그레이션, `policy.ts`의 완전매핑 Record(typecheck 강제), `validations`의 create 스키마 enum, 조회 allow-list 단일화(F1), catalog `RESOURCES`(집계 `workflows` 포함).

## Files
- Modify: `prisma/schema.prisma` (enum `WorkflowKind` +2)
- Create: `prisma/migrations/20260701000000_workflow_client_kinds/migration.sql`
- Modify: `src/modules/workflows/policy.ts` (`KIND_RESOURCE`, `TRANSITIONS`)
- Modify: `src/modules/workflows/validations/index.ts` (`WORKFLOW_KINDS`)
- Modify: `src/modules/workflows/services/tasks.ts` (`ALL_KINDS` enum-파생)
- Modify: `src/kernel/access/catalog.ts` (`RESOURCES` +3)
- Test: `tests/modules/workflows/policy.test.ts` (신규 kind 커버)
- Test: `tests/modules/workflows/tasks-service.test.ts` (R1 조회 커버리지)
- Test: `tests/modules/workflows/lifecycle.test.ts` (R2 client kind 생성 게이트)

## Prep
- 엔트리포인트 §Shared Contracts SC-1, SC-2, SC-3, SC-4, SC-10(RESOURCES 부분) 을 읽는다.
- Spec: D1(enum+완전매핑 Record), D2(전이 골격), D13(집계 `workflows` 리소스).

## Deps
없음(최초 태스크).

## Cautions
- **Don't 하드코딩 배열을 남기지 마라.** `ALL_KINDS`·page `KINDS`는 typecheck가 안 지켜서 enum에만 추가하면 조용히 신규 kind가 누락된다(API가 영구 빈 카테고리). Reason: F1 — `Object.keys(KIND_RESOURCE)` 단일 출처. (page `KINDS`는 task-05에서 처리.)
- **Don't `TRANSITIONS`/`KIND_RESOURCE`에서 신규 kind를 빼지 마라.** 둘 다 `Record<WorkflowKind,…>`라 typecheck가 즉시 실패한다. 이게 안전장치다.
- **Don't `prisma migrate dev`를 DB 없이 강제하지 마라.** 이 태스크의 AC는 `prisma:validate` + `prisma:generate`(둘 다 DB 불요 — 스키마만 읽음) + `typecheck`. 실제 enum 적용은 배포 시 `prisma migrate deploy`(task-06 §배포).

## TDD Steps

### 1. schema.prisma enum + 마이그레이션 (스키마부터 — 이후 타입/테스트가 이에 의존)

`prisma/schema.prisma`의 `enum WorkflowKind`(62~68행)에 2값 추가:

```prisma
enum WorkflowKind {
  WEEKLY_REPORT
  BILLING
  NOTIFICATION_BILLING
  WEEKLY_REPORT_CLIENT
  MONTHLY_REPORT_CLIENT

  @@schema("workflows")
}
```

마이그레이션 파일 생성 `prisma/migrations/20260701000000_workflow_client_kinds/migration.sql`(최신 `20260629142806_add_generation_lock` 이후 정렬):

```sql
-- AlterEnum: additive(forward-safe). 기존 값·행 불변.
ALTER TYPE "workflows"."WorkflowKind" ADD VALUE 'WEEKLY_REPORT_CLIENT';
ALTER TYPE "workflows"."WorkflowKind" ADD VALUE 'MONTHLY_REPORT_CLIENT';
```

검증:
```bash
npm run prisma:validate   # 스키마 유효
npm run prisma:generate   # @prisma/client의 WorkflowKind에 신규 2값 반영(DB 불요)
```
기대: validate 통과, generate 성공. 이후 `WorkflowKind` 타입에 신규 값이 포함되어 아래 Record 미완성 시 typecheck가 실패한다.

### 2. policy.ts — 실패 테스트(신규 kind 커버) 먼저

`tests/modules/workflows/policy.test.ts`의 첫 describe `TRANSITIONS (fail-closed)` 첫 it("3개 kind를 모두 정의한다")를 5종 커버로 교체하고 신규 kind 전이·리소스 테스트를 추가한다. 아래로 교체:

```ts
describe("TRANSITIONS (fail-closed)", () => {
  it("5개 kind를 모두 정의한다(신규 client 2종 포함)", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      ["BILLING", "MONTHLY_REPORT_CLIENT", "NOTIFICATION_BILLING", "WEEKLY_REPORT", "WEEKLY_REPORT_CLIENT"],
    );
  });

  it("WEEKLY_REPORT은 PENDING→GENERATED/CANCELLED만 허용(직접 SENT 불가)", () => {
    expect(TRANSITIONS.WEEKLY_REPORT.PENDING).toEqual(["GENERATED", "CANCELLED"]);
    expect(TRANSITIONS.WEEKLY_REPORT.PENDING).not.toContain("SENT");
  });

  it("모든 kind는 PENDING에서 CANCELLED로 갈 수 있다", () => {
    for (const kind of Object.keys(TRANSITIONS) as Array<keyof typeof TRANSITIONS>) {
      expect(TRANSITIONS[kind].PENDING).toContain("CANCELLED");
    }
  });

  it("NOTIFICATION_BILLING만 GENERATED→REVIEWED를 허용한다", () => {
    expect(TRANSITIONS.NOTIFICATION_BILLING.GENERATED).toContain("REVIEWED");
    expect(TRANSITIONS.WEEKLY_REPORT.GENERATED ?? []).not.toContain("REVIEWED");
  });

  it("BILLING은 SENT→HQ_REQUESTED→FINAL_SENT 사슬을 가진다", () => {
    expect(TRANSITIONS.BILLING.SENT).toEqual(["HQ_REQUESTED"]);
    expect(TRANSITIONS.BILLING.HQ_REQUESTED).toEqual(["FINAL_SENT"]);
  });

  it("신규 client 2종은 WEEKLY_REPORT 골격(PENDING→GENERATED/CANCELLED, GENERATED→SENT/CANCELLED)", () => {
    for (const kind of ["WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"] as const) {
      expect(TRANSITIONS[kind].PENDING).toEqual(["GENERATED", "CANCELLED"]);
      expect(TRANSITIONS[kind].GENERATED).toEqual(["SENT", "CANCELLED"]);
    }
  });
});
```

그리고 `describe("권한·stamp 매핑")`의 `it("KIND_RESOURCE")`에 신규 2종 단언을 추가:

```ts
  it("KIND_RESOURCE", () => {
    expect(KIND_RESOURCE.WEEKLY_REPORT).toBe("workflows.weekly");
    expect(KIND_RESOURCE.BILLING).toBe("workflows.billing");
    expect(KIND_RESOURCE.NOTIFICATION_BILLING).toBe("workflows.notification");
    expect(KIND_RESOURCE.WEEKLY_REPORT_CLIENT).toBe("workflows.weeklyClient");
    expect(KIND_RESOURCE.MONTHLY_REPORT_CLIENT).toBe("workflows.monthlyClient");
  });
```

실행:
```bash
npm test -- tests/modules/workflows/policy.test.ts
```
기대: **FAIL**(policy.ts 미갱신 — 신규 kind 미정의).

### 3. policy.ts 구현

`src/modules/workflows/policy.ts`의 `TRANSITIONS`와 `KIND_RESOURCE`에 신규 2종 추가:

```ts
export const TRANSITIONS: Record<WorkflowKind, Partial<Record<WorkflowStatus, WorkflowStatus[]>>> = {
  WEEKLY_REPORT: { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] },
  BILLING: {
    PENDING: ["GENERATED", "CANCELLED"],
    GENERATED: ["SENT", "CANCELLED"],
    SENT: ["HQ_REQUESTED"],
    HQ_REQUESTED: ["FINAL_SENT"],
  },
  NOTIFICATION_BILLING: {
    PENDING: ["GENERATED", "CANCELLED"],
    GENERATED: ["REVIEWED", "SENT", "CANCELLED"],
    REVIEWED: ["HQ_REQUESTED"],
    HQ_REQUESTED: ["FINAL_SENT"],
  },
  // 신규 client 2종 — 생성기 없어 실질은 예약(PENDING)+취소. 골격은 WEEKLY_REPORT 재사용(D2).
  WEEKLY_REPORT_CLIENT: { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] },
  MONTHLY_REPORT_CLIENT: { PENDING: ["GENERATED", "CANCELLED"], GENERATED: ["SENT", "CANCELLED"] },
};

export const KIND_RESOURCE: Record<WorkflowKind, string> = {
  WEEKLY_REPORT: "workflows.weekly",
  BILLING: "workflows.billing",
  NOTIFICATION_BILLING: "workflows.notification",
  WEEKLY_REPORT_CLIENT: "workflows.weeklyClient",
  MONTHLY_REPORT_CLIENT: "workflows.monthlyClient",
};
```

(같은 파일의 `DOWNLOADABLE_STATUSES`·`ACTION_FOR_STATUS`·`STAMP_FOR_STATUS`·`SEND_STEP_TRANSITION`은 **불변** — 신규 kind는 생성기·발송 스텝이 없어 `SEND_STEP_TRANSITION`에 항목을 추가하지 않는다.)

실행:
```bash
npm test -- tests/modules/workflows/policy.test.ts
```
기대: **PASS**.

### 3b. R2 — client kind 생성 게이트(lifecycle, 서버 강제)

`createTask`(lifecycle.ts)는 코드 변경 없이 신규 kind를 지원한다(게이트 = `KIND_RESOURCE[kind]:create` 동일 로직). 회귀 테스트로 client kind 경로를 못박는다. `tests/modules/workflows/lifecycle.test.ts`의 `describe("createTask")` 끝에 추가:

```ts
  it("client kind: create 미부여 → ForbiddenError(R2·F1a — 타입 해석 전 차단)", async () => {
    await expect(
      createTask({ kind: "WEEKLY_REPORT_CLIENT", scheduledAt: new Date() }, baseCtx({ keys: ["workflows.weeklyClient:view"] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(m.findWorkflowTypeByKind).not.toHaveBeenCalled();
  });

  it("client kind: create 부여 → PENDING 예약 생성(R2·F1b, 수준 B)", async () => {
    m.findWorkflowTypeByKind.mockResolvedValue({ id: "monthly-report-client" });
    m.createTaskWithInitialEvent.mockResolvedValue({ id: "c1" });
    const out = await createTask(
      { kind: "MONTHLY_REPORT_CLIENT", scheduledAt: new Date("2026-07-20") },
      baseCtx({ keys: ["workflows.monthlyClient:create"] }),
    );
    expect(out).toEqual({ id: "c1" });
    expect(m.findWorkflowTypeByKind).toHaveBeenCalledWith("MONTHLY_REPORT_CLIENT");
    expect(m.createTaskWithInitialEvent).toHaveBeenCalledWith({ typeId: "monthly-report-client", scheduledAt: new Date("2026-07-20"), createdById: "u1" });
  });
```

실행:
```bash
npm test -- tests/modules/workflows/lifecycle.test.ts
```
기대: **PASS**(lifecycle.ts·repo 무변경 — `KIND_RESOURCE`에 신규 kind가 생겨 게이트가 그대로 동작). 이 테스트가 실패하면 policy `KIND_RESOURCE` 매핑을 확인.

주: `create` 부여만 있고 `generate` 미부여이므로 상세에서 문서 생성 액션이 안 뜬다(R2·F1c "예약 전용" — 생성기 없는 kind는 `:generate` 권한 미부여로 자연히 충족, workflow-detail.tsx **불변**).

### 4. validations — create 스키마 enum 5종

`src/modules/workflows/validations/index.ts` 7행 교체:

```ts
const WORKFLOW_KINDS = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING", "WEEKLY_REPORT_CLIENT", "MONTHLY_REPORT_CLIENT"] as const;
```

(스키마 정의 `createTaskSchema`·`parseStatusList` 등 나머지는 불변.)

### 5. tasks.ts — ALL_KINDS enum-파생(F1) + R1 회귀 테스트

먼저 실패 테스트를 `tests/modules/workflows/tasks-service.test.ts`의 `describe("getTaskList")` 안에 추가:

```ts
  it("신규 client kind도 view 보유 시 repo에 전달된다(R1 — ALL_KINDS enum 커버리지)", async () => {
    await getTaskList(
      { permissionKeys: new Set(["workflows.weeklyClient:view", "workflows.monthlyClient:view"]) },
      {},
    );
    const arg = m.findTaskList.mock.calls[0][0];
    expect(arg.kinds.sort()).toEqual(["MONTHLY_REPORT_CLIENT", "WEEKLY_REPORT_CLIENT"]);
  });
```

실행:
```bash
npm test -- tests/modules/workflows/tasks-service.test.ts
```
기대: **FAIL**(`ALL_KINDS`가 하드코딩 3종이라 신규 kind 미포함 → `kinds=[]`).

구현 — `src/modules/workflows/services/tasks.ts` 17행 교체:

```ts
// 조회 allow-list 단일 출처(F1): 완전매핑 Record에서 파생 → 신규 kind가 typecheck 없이 자동 포함.
const ALL_KINDS = Object.keys(KIND_RESOURCE) as WorkflowKind[];
```

(`import { KIND_RESOURCE } from "../policy";`는 이미 존재 — 유지. `WorkflowKind` 타입 import도 이미 존재.)

실행:
```bash
npm test -- tests/modules/workflows/tasks-service.test.ts
```
기대: **PASS**.

### 6. catalog RESOURCES — client 2종 + 집계 workflows(D13)

`src/kernel/access/catalog.ts`의 `RESOURCES`(1~8행) 중 workflows 줄 교체:

```ts
  "workflows", "workflows.weekly", "workflows.billing", "workflows.notification",
  "workflows.weeklyClient", "workflows.monthlyClient",
```

(`"workflows"` = nav 게이팅용 집계 리소스(D13). `…:view` 권한은 seed의 VIEW_RESOURCES 루프가 자동 생성.)

### 7. 커밋

```bash
npm run typecheck && npm run lint && npm test
```
기대: 전부 green. 이후 커밋.

## Acceptance Criteria
- `npm run prisma:validate` → 통과.
- `npm run prisma:generate` → 성공(`WorkflowKind`에 신규 2값).
- `npm run typecheck` → 통과(`Record<WorkflowKind,…>` 완전매핑 확인 — 신규 kind 누락 시 여기서 실패).
- `npm run lint` → 통과(boundaries 포함).
- `npm test -- tests/modules/workflows/policy.test.ts tests/modules/workflows/tasks-service.test.ts tests/modules/workflows/lifecycle.test.ts` → 통과.
- `prisma/migrations/20260701000000_workflow_client_kinds/migration.sql` 존재, additive `ADD VALUE` 2줄.
- R2: client kind create 미부여→403(ForbiddenError), 부여→PENDING 생성(lifecycle 무변경 확인).
- `RESOURCES`에 `"workflows"`, `"workflows.weeklyClient"`, `"workflows.monthlyClient"` 포함.
