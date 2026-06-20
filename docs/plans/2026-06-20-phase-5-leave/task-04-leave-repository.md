# Task 04 — leave repository·validations

**Purpose:** leave 도메인의 모든 Prisma 접근(조회·생성·트랜잭션 증감)을 repository에 모은다. `usedDays`는 atomic `increment`/`decrement`로 갱신(경계: Prisma는 repository에서만). zod 입력 스키마도 정의.

## Files
- Create: `src/modules/leave/repositories/index.ts`
- Create: `src/modules/leave/validations/index.ts`
- Create: `tests/modules/leave/repositories.test.ts`

## Prep
- spec §6 / entrypoint §SC-1, §SC-2, §SC-4, §SC-8(in-memory prisma fake).
- POC tx 참조: `leaveRequest.service.ts`(approve/cancel/update/delete), `allocation.service.ts`(adjust).
- **POC 적응**: `reviewedBy`→`reviewedById`, `modifiedByAdmin*` 제거(`adminActionNote`만), `isActive`→`status:"ACTIVE"`.

## Deps
- 01 (스키마·Prisma Client).

## Steps

### 1. validations
`src/modules/leave/validations/index.ts`:

```ts
import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다.");

export const createLeaveSchema = z.object({
  leaveType: z.enum(["ANNUAL", "HALF", "QUARTER"]),
  leaveSubType: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  quarterStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  startDate: dateStr,
  endDate: dateStr,
  reason: z.string().max(1000).nullish(),
});

export const adminCreateLeaveSchema = createLeaveSchema.extend({
  userId: z.string().min(1),
  sendNotification: z.boolean().optional(),
});

export const updateLeaveSchema = z.object({
  leaveType: z.enum(["ANNUAL", "HALF", "QUARTER"]).optional(),
  leaveSubType: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  quarterStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  reason: z.string().max(1000).nullish(),
  adminActionNote: z.string().max(500).nullish(),
});

export const rejectSchema = z.object({ rejectionReason: z.string().min(1).max(500) });
export const cancelSchema = z.object({ cancellationReason: z.string().max(500).nullish() });

export const upsertAllocationSchema = z.object({
  allocatedDays: z.number().min(0),
  carriedOverDays: z.number().min(0).default(0),
  carriedOverExpiryDate: dateStr.nullish(),
});

export const adjustAllocationSchema = z.object({
  changeDays: z.number().positive(), // 양수 크기. 부호는 changeType이 결정(ADD=+, DEDUCT=-)
  changeType: z.enum(["ADD", "DEDUCT"]),
  reason: z.string().min(1).max(200),
  reasonDetail: z.string().max(500).nullish(),
});
```

### 2. 실패 테스트
`tests/modules/leave/repositories.test.ts` — in-memory fake로 핵심 tx 동작(원자 증감·상태 가드)을 검증. (calendar/workflows 테스트의 `vi.mock("@/lib/prisma")` 패턴 따름. 아래는 대표 케이스이며, 실제 fake는 workflows mail-repository.test.ts 스타일로 구현.)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// $transaction은 콜백에 tx 클라이언트(=같은 fake)를 넘기는 형태로 모킹.
const db = {
  leaveRequest: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), aggregate: vi.fn() },
  leaveAllocation: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  leaveAllocationHistory: { create: vi.fn(), findMany: vi.fn() },
};
const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
vi.mock("@/lib/prisma", () => ({ prisma }));

import { approveTx, cancelTx, updateByAdminTx, adjustAllocationTx, findOverlap } from "@/modules/leave/repositories";
import { LeaveConflictError } from "@/modules/leave/errors";

beforeEach(() => { vi.clearAllMocks(); });

describe("approveTx", () => {
  it("PENDING이면 APPROVED + usedDays increment", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await approveTx("r1", "admin1");
    expect(db.leaveAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1", year: 2026 }, data: { usedDays: { increment: 1 } },
    }));
  });
  it("이미 처리됨이면 LeaveConflictError", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("할당 없으면 LeaveConflictError(증감 0건)", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-14T00:00:00Z"), days: 1 });
    db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(approveTx("r1", "admin1")).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("cancelTx", () => {
  it("APPROVED 취소 → CANCELLED + usedDays decrement", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-20T00:00:00Z"), days: 2 });
    db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    db.leaveAllocation.updateMany.mockResolvedValue({ count: 1 });
    await cancelTx("r1", "이유");
    expect(db.leaveAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { usedDays: { decrement: 2 } },
    }));
  });
  it("PENDING 취소 → CANCELLED, usedDays 변화 없음", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1", startDate: new Date("2026-08-20T00:00:00Z"), days: 2 });
    db.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    await cancelTx("r1", "이유");
    expect(db.leaveAllocation.updateMany).not.toHaveBeenCalled();
  });
});

describe("updateByAdminTx", () => {
  const patch = {
    leaveType: "ANNUAL" as const, leaveSubType: null, quarterStartTime: null,
    startDate: new Date("2027-01-04T00:00:00Z"), endDate: new Date("2027-01-04T00:00:00Z"),
    newDays: 1, reason: null, adminActionNote: null,
  };
  it("APPROVED 교차연도 수정: 신규연도 할당 없으면 LeaveConflictError(롤백)", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-12-31T00:00:00Z"), days: 1 });
    db.leaveRequest.update.mockResolvedValue({ id: "r1" });
    db.leaveAllocation.updateMany
      .mockResolvedValueOnce({ count: 1 })  // old year(2026) decrement
      .mockResolvedValueOnce({ count: 0 }); // new year(2027) increment → 할당 없음
    await expect(updateByAdminTx("r1", patch)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("APPROVED 동일연도 수정: 할당 없으면 LeaveConflictError", async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ status: "APPROVED", userId: "u1", startDate: new Date("2026-08-10T00:00:00Z"), days: 1 });
    db.leaveRequest.update.mockResolvedValue({ id: "r1" });
    db.leaveAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateByAdminTx("r1", { ...patch, startDate: new Date("2026-08-11T00:00:00Z"), endDate: new Date("2026-08-11T00:00:00Z") })).rejects.toBeInstanceOf(LeaveConflictError);
  });
});

describe("findOverlap", () => {
  it("PENDING/APPROVED 겹침 쿼리", async () => {
    db.leaveRequest.findFirst.mockResolvedValue(null);
    await findOverlap("u1", new Date("2026-08-14T00:00:00Z"), new Date("2026-08-15T00:00:00Z"));
    expect(db.leaveRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "u1", status: { in: ["PENDING", "APPROVED"] } }),
    }));
  });
});

describe("adjustAllocationTx", () => {
  it("DEDUCT는 양수 크기를 차감(부호는 changeType), history는 양수로 기록", async () => {
    db.leaveAllocation.findUnique.mockResolvedValue({ id: "a1", allocatedDays: 15, carriedOverDays: 0, usedDays: 5 });
    db.leaveAllocation.update.mockResolvedValue({ id: "a1" });
    db.leaveAllocationHistory.create.mockResolvedValue({ id: "h1" });
    await adjustAllocationTx({ userId: "u1", year: 2026, changeDays: 2, changeType: "DEDUCT", reason: "차감", reasonDetail: null, adminId: "admin1" });
    expect(db.leaveAllocation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { allocatedDays: 13 } }));
    expect(db.leaveAllocationHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changeType: "DEDUCT", changeDays: 2, beforeDays: 10, afterDays: 8 }),
    }));
  });
});
```

```
npm test -- tests/modules/leave/repositories   # expect FAIL
```

### 3. 최소 구현
`src/modules/leave/repositories/index.ts`:

```ts
import "server-only";
import type { LeaveRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LeaveConflictError } from "../errors";

// ── 조회 ──
const userSelect = { select: { id: true, name: true, email: true, department: true, position: true } };

export function getRequestById(id: string) {
  return prisma.leaveRequest.findUnique({ where: { id }, include: { user: userSelect } });
}

export function listRequests(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  return prisma.leaveRequest.findMany({
    where: {
      user: { status: "ACTIVE" },
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
    },
    include: { user: userSelect },
    orderBy: { createdAt: "desc" },
  });
}

export function findActiveAllocation(userId: string, year: number) {
  return prisma.leaveAllocation.findUnique({ where: { userId_year: { userId, year } } });
}

export async function sumPendingDays(userId: string, year: number): Promise<number> {
  const res = await prisma.leaveRequest.aggregate({
    where: {
      userId, status: "PENDING",
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
    },
    _sum: { days: true },
  });
  return res._sum.days ? Number(res._sum.days) : 0;
}

export function findOverlap(userId: string, start: Date, end: Date, excludeId?: string) {
  return prisma.leaveRequest.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      status: { in: ["PENDING", "APPROVED"] },
      AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }],
    },
  });
}

// ── 생성 ──
export function createPendingRequest(data: {
  userId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null;
}) {
  return prisma.leaveRequest.create({
    data: {
      userId: data.userId, leaveType: data.leaveType,
      leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
      quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
      startDate: data.startDate, endDate: data.endDate, days: data.days,
      reason: data.reason ?? null, status: "PENDING",
    },
    include: { user: userSelect },
  });
}

// 관리자 직접입력 — 자동 APPROVED + usedDays increment(원자).
export async function createApprovedRequestTx(data: {
  userId: string; adminId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType?: "MORNING" | "AFTERNOON" | null; quarterStartTime?: string | null;
  startDate: Date; endDate: Date; days: number; reason?: string | null; adminActionNote?: string | null;
}) {
  const year = data.startDate.getUTCFullYear();
  return prisma.$transaction(async (tx) => {
    const alloc = await tx.leaveAllocation.updateMany({
      where: { userId: data.userId, year }, data: { usedDays: { increment: data.days } },
    });
    if (alloc.count === 0) throw new LeaveConflictError(`${year}년도 연차 할당 정보가 없습니다.`);
    return tx.leaveRequest.create({
      data: {
        userId: data.userId, leaveType: data.leaveType,
        leaveSubType: data.leaveType === "HALF" ? data.leaveSubType ?? null : null,
        quarterStartTime: data.leaveType === "QUARTER" ? data.quarterStartTime ?? null : null,
        startDate: data.startDate, endDate: data.endDate, days: data.days, reason: data.reason ?? null,
        status: "APPROVED", reviewedById: data.adminId, reviewedAt: new Date(),
        adminActionNote: data.adminActionNote ?? "관리자 직접입력",
      },
      include: { user: userSelect },
    });
  });
}

// ── 전이 tx (상태 가드 + 원자 증감) ──
export async function approveTx(requestId: string, adminId: string) {
  await prisma.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING") throw new LeaveConflictError("이미 처리된 신청입니다.");
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: adminId, reviewedAt: new Date() },
    });
    if (updated.count === 0) throw new LeaveConflictError("이미 처리된 신청입니다.");
    const alloc = await tx.leaveAllocation.updateMany({
      where: { userId: req.userId, year: req.startDate.getUTCFullYear() },
      data: { usedDays: { increment: req.days } },
    });
    if (alloc.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
  });
}

export async function rejectRequest(requestId: string, adminId: string, rejectionReason: string) {
  const updated = await prisma.leaveRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date(), rejectionReason },
  });
  if (updated.count === 0) throw new LeaveConflictError("이미 처리된 신청입니다.");
}

// 취소 — CANCELLED + (APPROVED였으면) usedDays decrement.
export async function cancelTx(requestId: string, cancellationReason: string | null) {
  await prisma.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (req.status !== "PENDING" && req.status !== "APPROVED") throw new LeaveConflictError("취소할 수 없는 상태입니다.");
    const wasApproved = req.status === "APPROVED";
    const updated = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: req.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason },
    });
    if (updated.count === 0) throw new LeaveConflictError("상태가 이미 변경되었습니다.");
    if (wasApproved) {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: req.userId, year: req.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: req.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
  });
}

// 관리자 수정 — days 재계산 결과를 받아 같은/교차 연도 usedDays 보정.
export async function updateByAdminTx(requestId: string, patch: {
  leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null; startDate: Date; endDate: Date; newDays: number;
  reason: string | null; adminActionNote: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    const updated = await tx.leaveRequest.update({
      where: { id: requestId },
      data: {
        leaveType: patch.leaveType,
        leaveSubType: patch.leaveType === "HALF" ? patch.leaveSubType : null,
        quarterStartTime: patch.leaveType === "QUARTER" ? patch.quarterStartTime : null,
        startDate: patch.startDate, endDate: patch.endDate, days: patch.newDays,
        reason: patch.reason, adminActionNote: patch.adminActionNote ?? "관리자 수정",
      },
      include: { user: userSelect },
    });
    if (existing.status === "APPROVED") {
      const oldYear = existing.startDate.getUTCFullYear();
      const newYear = patch.startDate.getUTCFullYear();
      if (oldYear === newYear) {
        const diff = patch.newDays - Number(existing.days);
        const r = await tx.leaveAllocation.updateMany({ where: { userId: existing.userId, year: oldYear }, data: { usedDays: { increment: diff } } });
        if (r.count === 0) throw new LeaveConflictError(`${oldYear}년도 연차 할당 정보가 없습니다.`);
      } else {
        const rOld = await tx.leaveAllocation.updateMany({ where: { userId: existing.userId, year: oldYear }, data: { usedDays: { decrement: existing.days } } });
        if (rOld.count === 0) throw new LeaveConflictError(`${oldYear}년도 연차 할당 정보가 없습니다.`);
        const rNew = await tx.leaveAllocation.updateMany({ where: { userId: existing.userId, year: newYear }, data: { usedDays: { increment: patch.newDays } } });
        if (rNew.count === 0) throw new LeaveConflictError(`${newYear}년도 연차 할당 정보가 없습니다.`);
      }
    }
    return updated;
  });
}

export async function deleteByAdminTx(requestId: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRequest.findUnique({
      where: { id: requestId }, select: { status: true, userId: true, startDate: true, days: true },
    });
    if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
    if (existing.status === "APPROVED") {
      const r = await tx.leaveAllocation.updateMany({
        where: { userId: existing.userId, year: existing.startDate.getUTCFullYear() },
        data: { usedDays: { decrement: existing.days } },
      });
      if (r.count === 0) throw new LeaveConflictError("연차 할당 정보를 찾을 수 없습니다.");
    }
    await tx.leaveRequest.delete({ where: { id: requestId } });
  });
}

// ── 할당 ──
export function upsertAllocation(userId: string, year: number, data: {
  allocatedDays: number; carriedOverDays: number; carriedOverExpiryDate: Date | null;
}) {
  return prisma.leaveAllocation.upsert({
    where: { userId_year: { userId, year } },
    update: { allocatedDays: data.allocatedDays, carriedOverDays: data.carriedOverDays, carriedOverExpiryDate: data.carriedOverExpiryDate },
    create: { userId, year, allocatedDays: data.allocatedDays, carriedOverDays: data.carriedOverDays, carriedOverExpiryDate: data.carriedOverExpiryDate },
  });
}

// 조정 — allocatedDays 증감 + 이력. before/after = 조정 전/후 잔여(total - used).
export async function adjustAllocationTx(input: {
  userId: string; year: number; changeDays: number; changeType: "ADD" | "DEDUCT";
  reason: string; reasonDetail: string | null; adminId: string;
}) {
  // changeDays는 양수 크기, 부호는 changeType이 결정(ADD=+, DEDUCT=-).
  const delta = input.changeType === "DEDUCT" ? -input.changeDays : input.changeDays;
  return prisma.$transaction(async (tx) => {
    let alloc = await tx.leaveAllocation.findUnique({ where: { userId_year: { userId: input.userId, year: input.year } } });
    if (!alloc) {
      alloc = await tx.leaveAllocation.create({ data: { userId: input.userId, year: input.year, allocatedDays: 0, carriedOverDays: 0, usedDays: 0 } });
    }
    const total = Number(alloc.allocatedDays) + Number(alloc.carriedOverDays);
    const beforeDays = total - Number(alloc.usedDays);
    const newAllocated = Number(alloc.allocatedDays) + delta;
    if (newAllocated < 0) throw new LeaveConflictError("할당 연차가 음수가 될 수 없습니다.");
    const afterDays = beforeDays + delta;
    const updated = await tx.leaveAllocation.update({
      where: { userId_year: { userId: input.userId, year: input.year } },
      data: { allocatedDays: newAllocated },
    });
    const history = await tx.leaveAllocationHistory.create({
      data: {
        allocationId: alloc.id, userId: input.userId, changeType: input.changeType,
        changeDays: input.changeDays, reason: input.reason, reasonDetail: input.reasonDetail ?? null,
        beforeDays, afterDays, createdById: input.adminId,
      },
    });
    return { allocation: updated, history };
  });
}

export function listAllocations(year: number) {
  return prisma.leaveAllocation.findMany({ where: { year }, orderBy: { userId: "asc" } });
}

export function getAllocationHistory(userId: string, year?: number) {
  return prisma.leaveAllocationHistory.findMany({
    where: { userId, ...(year ? { allocation: { year } } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

// usedDays 재계산 — 해당 연도 APPROVED 합계로 확정(정합성 복구).
export async function recalculateUsedDaysTx(userId: string, year: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.leaveRequest.aggregate({
      where: {
        userId, status: "APPROVED",
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      _sum: { days: true },
    });
    const used = res._sum.days ? Number(res._sum.days) : 0;
    const r = await tx.leaveAllocation.updateMany({ where: { userId, year }, data: { usedDays: used } });
    if (r.count === 0) throw new LeaveConflictError(`${year}년도 연차 할당 정보가 없습니다.`);
    return used;
  });
}
```

```
npm test -- tests/modules/leave/repositories   # expect PASS
```

### 4. 커밋
```
git add src/modules/leave/repositories src/modules/leave/validations tests/modules/leave/repositories.test.ts
git commit -m "feat(leave): repository(원자 usedDays 증감·전이 tx)·zod 검증"
```

## Acceptance Criteria
- `npm test -- tests/modules/leave/repositories` → PASS.
- `npm run typecheck` / `npm run lint` → 그린.

## Cautions
- **Don't `allocation.usedDays + days`(read-then-write)로 갱신하지 말 것.** Reason: 동시성 경합 → 이중 가산/누락. 반드시 `{ increment }`/`{ decrement }`(SC-2).
- **Don't 상태 가드 없이 update하지 말 것.** Reason: 이미 처리된 신청 재처리·동시 승인-취소 경합. `updateMany({ where: { id, status } })` + count 0 → `LeaveConflictError`.
- **Don't `reviewedBy`/`modifiedByAdminId`를 쓰지 말 것.** Reason: ops-hub 스키마엔 `reviewedById`만, 수정 흔적은 `adminActionNote`(SC-1).
- **Don't year를 `getFullYear()`(로컬)로 뽑지 말 것.** Reason: UTC 자정 저장 날짜라 `getUTCFullYear()`가 정확.
- **Don't 할당 `increment`/`decrement`의 `count`를 무시하지 말 것.** Reason: 대상 할당 행이 없으면 `updateMany`가 0건 no-op인데 request는 커밋돼 `usedDays` 캐시 불변식이 조용히 깨진다. **특히 교차연도 수정**에서 신규연도 할당 부재 시 그렇다 — `approveTx`처럼 모든 할당 증감(`updateByAdminTx`/`cancelTx`/`deleteByAdminTx`/`recalculateUsedDaysTx`)에서 `count===0`이면 `LeaveConflictError`로 throw·롤백(SC-2).
- **Don't `adjustAllocationTx`에서 `changeDays`를 부호 그대로 더하지 말 것.** Reason: `changeDays`는 **양수 크기**, 부호는 `changeType`이 결정(`DEDUCT`면 `-changeDays`). zod `positive()`와 합쳐 `{DEDUCT, 2}`가 증가하거나 `{ADD, -2}`가 감소하는 오용을 차단. history엔 양수 크기로 기록.
