# Task 08 — 캘린더 CANCELLED 제외 보정

`WorkflowTask` lifecycle 도입으로 취소(CANCELLED) 작업이 생긴다. 캘린더 work/team/admin 뷰가 취소된 작업을 노출하지 않도록 calendar repository의 `findWorkflowTasksInRange`에 status 필터를 추가한다(spec §8).

## Files

- Modify: `src/modules/calendar/repositories/index.ts` (`findWorkflowTasksInRange`)
- Modify (test): `tests/modules/calendar/repository.test.ts` (회귀 테스트 추가)

## Prep

- Spec §8(캘린더 연동 — CANCELLED 제외 보정, 회귀 테스트 포함).
- 현재 `findWorkflowTasksInRange`(`src/modules/calendar/repositories/index.ts`)는 status 필터가 없어 CANCELLED도 노출된다.
- 이 변경은 `calendar` 모듈 내부지만 Phase 4 공통 기반 작업으로 둔다(WorkflowTask lifecycle 도입의 직접 결과).

## Deps

없음(기존 calendar 모듈만 수정). Task 01 스키마와 무관 — `CANCELLED`는 기존 `WorkflowStatus` enum 값.

## Step 1 — 실패 테스트 추가

`tests/modules/calendar/repository.test.ts`의 `describe("findWorkflowTasksInRange", ...)` 블록 안에 다음 `it`를 추가한다:

```ts
  it("CANCELLED 작업을 제외(status not CANCELLED)하고 scheduledAt 창으로 조회", async () => {
    rows.workflow = [{ id: "w1", scheduledAt: new Date("2026-06-12"), status: "PENDING", type: { name: "주간보고" } }];
    await findWorkflowTasksInRange(range);
    expect(calls.workflow.where.status).toEqual({ not: "CANCELLED" });
    expect(calls.workflow.where.scheduledAt).toEqual({ gte: range.start, lt: range.end });
  });
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/modules/calendar/repository.test.ts
```

기대: 추가 테스트가 `calls.workflow.where.status`가 `undefined`라 실패.

## Step 3 — 구현 수정

`src/modules/calendar/repositories/index.ts`의 `findWorkflowTasksInRange`에서 `where`를 다음으로 교체:

```ts
export async function findWorkflowTasksInRange(range: NormalizedRange): Promise<WorkflowRow[]> {
  const rows = await prisma.workflowTask.findMany({
    // 취소된 작업은 캘린더에 노출하지 않는다(spec §8, Phase 4 lifecycle 도입의 결과).
    where: { scheduledAt: { gte: range.start, lt: range.end }, status: { not: "CANCELLED" } },
    select: { id: true, scheduledAt: true, status: true, type: { select: { name: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, title: r.type.name, scheduledAt: r.scheduledAt, status: String(r.status) }));
}
```

기존 매핑·select·orderBy는 그대로. `where`에 `status: { not: "CANCELLED" }`만 추가한다.

## Step 4 — PASS

```bash
npm test -- tests/modules/calendar/repository.test.ts
```

## Step 5 — commit

```bash
git add src/modules/calendar/repositories/index.ts tests/modules/calendar/repository.test.ts
git commit -m "fix(calendar): exclude CANCELLED workflow tasks from feed (phase 4)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과
npm test -- tests/modules/calendar/   # calendar 스위트 전체 PASS(기존 매핑 테스트 회귀 없음)
```

## Cautions

- **`findWorkflowTasksInRange`의 기존 select/매핑/orderBy를 바꾸지 말 것.** `where`에 status 필터만 surgical하게 추가한다.
- workflowTask provider(`src/modules/calendar/sources/workflowTask.ts`)에 필터를 중복으로 넣지 말 것 — 출처는 repository 한 곳(spec §8 "calendar repository").
- 다른 calendar source(leave·manual 등)의 status 처리에 손대지 말 것 — 이 태스크는 WorkflowTask 한정.
