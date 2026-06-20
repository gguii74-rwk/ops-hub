# Task 06 — requests 서비스 (신청·승인·취소·관리자)

**Purpose:** 연차 신청 lifecycle 오케스트레이션 — rules 검증 + 공휴일 주입 일수 계산 + 중복 검사 + repository tx 호출 + 본인/관리자 게이트. POC `leaveRequest.service.ts` 충실 포팅.

## Files
- Create: `src/modules/leave/services/requests.ts`
- Create: `tests/modules/leave/requests-service.test.ts`

## Prep
- spec §5, §6 / entrypoint §SC-3, §SC-4, §SC-7(권한 키), §SC-8.
- POC: `leaveRequest.service.ts` 전체.
- 취소 규칙: 직원 본인은 APPROVED 당일/과거 취소 불가(POC), 관리자는 무제한. PENDING은 본인 취소 가능(usedDays 변화 없음).

## Deps
- 02 (holidays), 03 (rules/types/errors), 04 (repository), 05 (allocations — 본 태스크는 직접 의존 없지만 순서상 후행).

## Steps

### 1. 실패 테스트
`tests/modules/leave/requests-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} })); // kernel/access import 시 prisma 로드 회피
const holidays = vi.fn(async () => new Set<string>());
const ensureYearsSynced = vi.fn(async () => {});
vi.mock("@/kernel/holidays", () => ({ getHolidaysInRange: holidays, ensureYearsSynced }));
const repo = {
  getRequestById: vi.fn(), listRequests: vi.fn(), findActiveAllocation: vi.fn(), findOverlap: vi.fn(),
  createPendingRequest: vi.fn(), createApprovedRequestTx: vi.fn(), approveTx: vi.fn(), rejectRequest: vi.fn(),
  cancelTx: vi.fn(), updateByAdminTx: vi.fn(), deleteByAdminTx: vi.fn(),
};
vi.mock("@/modules/leave/repositories", () => repo);

import { createLeaveRequest, cancel, getRequest } from "@/modules/leave/services/requests";
import { LeaveConflictError, LeaveValidationError } from "@/modules/leave/errors";
import { ForbiddenError } from "@/kernel/access";

const employeeCtx = { userId: "u1", isOwner: false, permissionKeys: new Set<string>() };
const adminCtx = { userId: "admin1", isOwner: true, permissionKeys: new Set<string>() };

beforeEach(() => { vi.clearAllMocks(); holidays.mockResolvedValue(new Set()); });

describe("createLeaveRequest", () => {
  const input = { leaveType: "ANNUAL" as const, startDate: "2999-08-14", endDate: "2999-08-14" };
  it("할당 없으면 LeaveValidationError", async () => {
    repo.findActiveAllocation.mockResolvedValue(null);
    await expect(createLeaveRequest("u1", input)).rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("중복이면 LeaveConflictError", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 });
    repo.findOverlap.mockResolvedValue({ id: "x" });
    await expect(createLeaveRequest("u1", input)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("잔여 부족해도 생성(마이너스 허용)", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 0, carriedOverDays: 0, usedDays: 0 });
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" });
    await createLeaveRequest("u1", input);
    expect(repo.createPendingRequest).toHaveBeenCalledWith(expect.objectContaining({ days: 1, status: undefined }) ?? expect.anything());
    expect(repo.createPendingRequest).toHaveBeenCalled();
  });
  it("과거 날짜 거부", async () => {
    await expect(createLeaveRequest("u1", { leaveType: "ANNUAL", startDate: "2000-01-01", endDate: "2000-01-01" }))
      .rejects.toBeInstanceOf(LeaveValidationError);
  });
});

describe("cancel", () => {
  it("직원 본인 APPROVED 과거 → LeaveValidationError", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "u1", status: "APPROVED", startDate: new Date("2000-01-01T00:00:00Z") });
    await expect(cancel("r1", employeeCtx, null)).rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("직원 본인 PENDING → cancelTx 호출", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "u1", status: "PENDING", startDate: new Date("2999-01-01T00:00:00Z") });
    await cancel("r1", employeeCtx, "사유");
    expect(repo.cancelTx).toHaveBeenCalledWith("r1", "사유");
  });
  it("타인 신청을 일반 직원이 취소 → ForbiddenError", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "other", status: "PENDING", startDate: new Date("2999-01-01T00:00:00Z") });
    await expect(cancel("r1", employeeCtx, null)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("관리자는 타인 APPROVED 과거도 취소 가능", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "other", status: "APPROVED", startDate: new Date("2000-01-01T00:00:00Z") });
    await cancel("r1", adminCtx, null);
    expect(repo.cancelTx).toHaveBeenCalled();
  });
});

describe("getRequest", () => {
  it("타인 신청을 권한 없이 조회 → ForbiddenError", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other" });
    await expect(getRequest("r1", employeeCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

> 주: 위 "마이너스 허용" 테스트의 `status: undefined` 매처는 부정확하니 구현 시 `expect(repo.createPendingRequest).toHaveBeenCalledWith(expect.objectContaining({ days: 1 }))`로 단순화한다.

```
npm test -- tests/modules/leave/requests-service   # expect FAIL
```

### 2. 최소 구현
`src/modules/leave/services/requests.ts`:

```ts
import "server-only";
import type { LeaveRequestStatus, LeaveType, LeaveSubType } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { getHolidaysInRange, ensureYearsSynced } from "@/kernel/holidays";
import type { CreateLeaveInput, LeaveCtx } from "../types";
import { LeaveConflictError, LeaveValidationError } from "../errors";
import {
  parseLeaveDate, validateDates, validateDatesForAdmin, validateLeaveTypeDates,
  calculateLeaveDays, kstToday, toDateKey,
} from "../rules";
import {
  getRequestById, listRequests, findActiveAllocation, findOverlap,
  createPendingRequest, createApprovedRequestTx, approveTx, rejectRequest,
  cancelTx, updateByAdminTx, deleteByAdminTx,
} from "../repositories";

// 신청 기간이 걸친 연도(부팅 훅이 못 채운 먼 미래 연도 backstop).
const spannedYears = (start: Date, end: Date) => Array.from(new Set([start.getUTCFullYear(), end.getUTCFullYear()]));

// 직원 신청 — PENDING. 마이너스 연차 허용(잔여 부족도 거부 안 함).
export async function createLeaveRequest(userId: string, input: CreateLeaveInput) {
  const start = parseLeaveDate(input.startDate);
  const end = parseLeaveDate(input.endDate);
  validateDates(start, end, kstToday(new Date()));
  validateLeaveTypeDates(input.leaveType, start, end);
  await ensureYearsSynced(spannedYears(start, end));
  const days = calculateLeaveDays(input.leaveType, start, end, await getHolidaysInRange(start, end));

  const year = start.getUTCFullYear();
  if (!(await findActiveAllocation(userId, year))) throw new LeaveValidationError(`${year}년도 연차 할당 정보가 없습니다.`);
  if (await findOverlap(userId, start, end)) throw new LeaveConflictError("해당 기간에 이미 신청된 연차가 있습니다.");

  return createPendingRequest({
    userId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason,
  });
}

// 관리자 직접입력 — 자동 APPROVED, 과거 허용.
export async function createLeaveRequestByAdmin(adminId: string, targetUserId: string, input: CreateLeaveInput, adminActionNote?: string | null) {
  const start = parseLeaveDate(input.startDate);
  const end = parseLeaveDate(input.endDate);
  validateDatesForAdmin(start, end);
  validateLeaveTypeDates(input.leaveType, start, end);
  await ensureYearsSynced(spannedYears(start, end));
  const days = calculateLeaveDays(input.leaveType, start, end, await getHolidaysInRange(start, end));

  if (await findOverlap(targetUserId, start, end)) throw new LeaveConflictError("해당 기간에 이미 신청된 연차가 있습니다.");

  return createApprovedRequestTx({
    userId: targetUserId, adminId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason, adminActionNote,
  });
}

export function listMyRequests(userId: string, statuses?: LeaveRequestStatus[]) {
  return listRequests({ userId, statuses });
}
export function listAllRequests(filter: { userId?: string; statuses?: LeaveRequestStatus[] }) {
  return listRequests(filter);
}

export async function getRequest(id: string, ctx: LeaveCtx) {
  const req = await getRequestById(id);
  if (!req) return null;
  const canManage = ctx.isOwner || ctx.permissionKeys.has("leave.approval:view");
  if (req.userId !== ctx.userId && !canManage) throw new ForbiddenError("본인 신청만 조회할 수 있습니다.");
  return req;
}

export function approve(requestId: string, adminId: string) {
  return approveTx(requestId, adminId);
}
export function reject(requestId: string, adminId: string, rejectionReason: string) {
  return rejectRequest(requestId, adminId, rejectionReason);
}

// 취소 — 본인 또는 관리자. 직원 본인은 APPROVED 당일/과거 취소 불가.
export async function cancel(requestId: string, ctx: LeaveCtx, cancellationReason: string | null) {
  const req = await getRequestById(requestId);
  if (!req) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const isManager = ctx.isOwner || ctx.permissionKeys.has("leave.request:update");
  if (req.userId !== ctx.userId && !isManager) throw new ForbiddenError("본인 또는 관리자만 취소할 수 있습니다.");
  if (!isManager && req.status === "APPROVED" && toDateKey(req.startDate) <= toDateKey(kstToday(new Date()))) {
    throw new LeaveValidationError("연차 사용일 당일 또는 이후에는 취소할 수 없습니다.");
  }
  await cancelTx(requestId, cancellationReason);
}

// 관리자 수정 — days 재계산 후 tx 보정.
export async function updateByAdmin(requestId: string, input: {
  leaveType?: LeaveType; leaveSubType?: LeaveSubType | null; quarterStartTime?: string | null;
  startDate?: string; endDate?: string; reason?: string | null; adminActionNote?: string | null;
}) {
  const existing = await getRequestById(requestId);
  if (!existing) throw new LeaveConflictError("연차 신청을 찾을 수 없습니다.");
  const start = input.startDate ? parseLeaveDate(input.startDate) : existing.startDate;
  const end = input.endDate ? parseLeaveDate(input.endDate) : existing.endDate;
  const leaveType = input.leaveType ?? existing.leaveType;
  validateDatesForAdmin(start, end);
  validateLeaveTypeDates(leaveType, start, end);
  await ensureYearsSynced(spannedYears(start, end));
  const newDays = calculateLeaveDays(leaveType, start, end, await getHolidaysInRange(start, end));

  if (await findOverlap(existing.userId, start, end, requestId)) throw new LeaveConflictError("해당 기간에 이미 다른 연차가 있습니다.");

  return updateByAdminTx(requestId, {
    leaveType,
    leaveSubType: leaveType === "HALF" ? (input.leaveSubType ?? existing.leaveSubType) : null,
    quarterStartTime: leaveType === "QUARTER" ? (input.quarterStartTime ?? existing.quarterStartTime) : null,
    startDate: start, endDate: end, newDays,
    reason: input.reason !== undefined ? input.reason : existing.reason,
    adminActionNote: input.adminActionNote ?? null,
  });
}

export function deleteByAdmin(requestId: string) {
  return deleteByAdminTx(requestId);
}
```

```
npm test -- tests/modules/leave/requests-service   # expect PASS
```

### 3. 커밋
```
git add src/modules/leave/services/requests.ts tests/modules/leave/requests-service.test.ts
git commit -m "feat(leave): requests 서비스(신청·승인·취소·관리자 직접입력/수정/삭제)"
```

## Acceptance Criteria
- `npm test -- tests/modules/leave/requests-service` → PASS(전 케이스).
- `npm run typecheck` / `npm run lint` → 그린.

## Cautions
- **Don't 잔여 부족을 거부하지 말 것.** Reason: POC는 마이너스 허용(경고만). 할당 "존재"만 검사, 잔여량은 검사 안 함(spec §5).
- **Don't 직원 취소 날짜 게이트를 관리자에도 적용하지 말 것.** Reason: 관리자는 과거 포함 무제한 취소(spec §6). `isManager` 분기 필수.
- **Don't 권한(`requirePermission`) 검사를 서비스에 넣지 말 것.** Reason: 라우트가 resource:action 검사(SC-8). 서비스는 본인/대상 게이트만(LeaveCtx).
- **Don't 공휴일 조회를 rules 안에서 하지 말 것.** Reason: rules는 순수. 서비스가 `getHolidaysInRange`로 Set을 만들어 주입.
