# Task 05 — allocations 서비스 (요약·조정·recalculate)

**Purpose:** 연차 할당 요약 계산·설정·조정(이력)·`usedDays` 재계산을 서비스로 노출. repository를 조합하고 DTO(`AllocationSummary`)로 매핑.

## Files
- Create: `src/modules/leave/services/allocations.ts`
- Create: `tests/modules/leave/allocations-service.test.ts`

## Prep
- spec §6(할당·요약·조정) / entrypoint §SC-2, §SC-3(AllocationSummary, AdjustAllocationInput).
- POC: `allocation.service.ts` `getAllocationSummary`/`adjustAllocation`.

## Deps
- 03 (types/rules), 04 (repository).

## Steps

### 1. 실패 테스트
`tests/modules/leave/allocations-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const repo = {
  findActiveAllocation: vi.fn(), sumPendingDays: vi.fn(), upsertAllocation: vi.fn(),
  adjustAllocationTx: vi.fn(), recalculateUsedDaysTx: vi.fn(), listAllocations: vi.fn(), getAllocationHistory: vi.fn(),
};
vi.mock("@/modules/leave/repositories", () => repo);

import { getAllocationSummary, adjustAllocation, recalculate } from "@/modules/leave/services/allocations";

beforeEach(() => vi.clearAllMocks());

describe("getAllocationSummary", () => {
  it("remaining = total - used - pending", async () => {
    repo.findActiveAllocation.mockResolvedValue({
      allocatedDays: 15, carriedOverDays: 3, usedDays: 5, carriedOverExpiryDate: null,
    });
    repo.sumPendingDays.mockResolvedValue(2);
    const s = await getAllocationSummary("u1", 2026);
    expect(s).toMatchObject({ totalDays: 18, usedDays: 5, pendingDays: 2, remainingDays: 11 });
  });
  it("할당 없으면 null", async () => {
    repo.findActiveAllocation.mockResolvedValue(null);
    expect(await getAllocationSummary("u1", 2026)).toBeNull();
  });
});

describe("adjustAllocation", () => {
  it("repository tx에 위임", async () => {
    repo.adjustAllocationTx.mockResolvedValue({ allocation: {}, history: {} });
    await adjustAllocation({ userId: "u1", year: 2026, changeDays: 2, changeType: "ADD", reason: "보상" }, "admin1");
    expect(repo.adjustAllocationTx).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", changeDays: 2, adminId: "admin1" }));
  });
});

describe("recalculate", () => {
  it("repository tx에 위임", async () => {
    repo.recalculateUsedDaysTx.mockResolvedValue(7);
    expect(await recalculate("u1", 2026)).toBe(7);
  });
});
```

```
npm test -- tests/modules/leave/allocations-service   # expect FAIL
```

### 2. 최소 구현
`src/modules/leave/services/allocations.ts`:

```ts
import "server-only";
import type { AllocationSummary, AdjustAllocationInput } from "../types";
import { parseLeaveDate } from "../rules";
import {
  findActiveAllocation, sumPendingDays, upsertAllocation as upsertAllocationRepo,
  adjustAllocationTx, recalculateUsedDaysTx, listAllocations as listAllocationsRepo, getAllocationHistory as getHistoryRepo,
} from "../repositories";

// 연차 요약. 할당 없으면 null(UI는 "미설정" 표시).
export async function getAllocationSummary(userId: string, year: number): Promise<AllocationSummary | null> {
  const alloc = await findActiveAllocation(userId, year);
  if (!alloc) return null;
  const pendingDays = await sumPendingDays(userId, year);
  const allocatedDays = Number(alloc.allocatedDays);
  const carriedOverDays = Number(alloc.carriedOverDays);
  const usedDays = Number(alloc.usedDays);
  const totalDays = allocatedDays + carriedOverDays;
  return {
    year, allocatedDays, carriedOverDays, totalDays, usedDays, pendingDays,
    remainingDays: totalDays - usedDays - pendingDays,
    carriedOverExpiryDate: alloc.carriedOverExpiryDate ?? null,
  };
}

export function setAllocation(userId: string, year: number, input: {
  allocatedDays: number; carriedOverDays: number; carriedOverExpiryDate?: string | null;
}) {
  return upsertAllocationRepo(userId, year, {
    allocatedDays: input.allocatedDays,
    carriedOverDays: input.carriedOverDays,
    carriedOverExpiryDate: input.carriedOverExpiryDate ? parseLeaveDate(input.carriedOverExpiryDate) : null,
  });
}

export function adjustAllocation(input: AdjustAllocationInput, adminId: string) {
  return adjustAllocationTx({
    userId: input.userId, year: input.year, changeDays: input.changeDays,
    changeType: input.changeType, reason: input.reason, reasonDetail: input.reasonDetail ?? null, adminId,
  });
}

export function recalculate(userId: string, year: number): Promise<number> {
  return recalculateUsedDaysTx(userId, year);
}

export function listAllocations(year: number) {
  return listAllocationsRepo(year);
}

export function getAllocationHistory(userId: string, year?: number) {
  return getHistoryRepo(userId, year);
}
```

```
npm test -- tests/modules/leave/allocations-service   # expect PASS
```

### 3. 커밋
```
git add src/modules/leave/services/allocations.ts tests/modules/leave/allocations-service.test.ts
git commit -m "feat(leave): allocations 서비스(요약 계산·조정·recalculate)"
```

## Acceptance Criteria
- `npm test -- tests/modules/leave/allocations-service` → PASS.
- `npm run typecheck` / `npm run lint` → 그린.

## Cautions
- **Don't `Decimal` 객체를 그대로 산술하지 말 것.** Reason: `Number(...)`로 변환 후 계산해야 요약 숫자가 정확(SC-2). 저장은 repository가 Decimal로.
- **Don't 요약에서 pending을 빠뜨리지 말 것.** Reason: `remaining = total - used - pending`(spec §6). 대기 신청도 잔여에서 차감.
