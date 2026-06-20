import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} })); // kernel/access import 시 prisma 로드 회피
vi.mock("@/kernel/holidays", () => ({
  getHolidaysInRange: vi.fn(async () => new Set<string>()),
  ensureYearsSynced: vi.fn(async () => {}),
  getUnsyncedYears: vi.fn(async () => [] as number[]),
}));
vi.mock("@/modules/leave/repositories", () => ({
  getRequestById: vi.fn(), listRequests: vi.fn(), findActiveAllocation: vi.fn(), findOverlap: vi.fn(),
  createPendingRequest: vi.fn(), createApprovedRequestTx: vi.fn(), approveTx: vi.fn(), rejectRequest: vi.fn(),
  cancelTx: vi.fn(), updateByAdminTx: vi.fn(), deleteByAdminTx: vi.fn(),
}));

import { createLeaveRequest, cancel, getRequest } from "@/modules/leave/services/requests";
import { LeaveConflictError, LeaveValidationError } from "@/modules/leave/errors";
import { ForbiddenError } from "@/kernel/access";
import * as holidaysMod from "@/kernel/holidays";
import * as repoMod from "@/modules/leave/repositories";

const holidays = vi.mocked(holidaysMod.getHolidaysInRange);
const getUnsyncedYears = vi.mocked(holidaysMod.getUnsyncedYears);
const repo = {
  getRequestById: vi.mocked(repoMod.getRequestById),
  listRequests: vi.mocked(repoMod.listRequests),
  findActiveAllocation: vi.mocked(repoMod.findActiveAllocation),
  findOverlap: vi.mocked(repoMod.findOverlap),
  createPendingRequest: vi.mocked(repoMod.createPendingRequest),
  createApprovedRequestTx: vi.mocked(repoMod.createApprovedRequestTx),
  approveTx: vi.mocked(repoMod.approveTx),
  rejectRequest: vi.mocked(repoMod.rejectRequest),
  cancelTx: vi.mocked(repoMod.cancelTx),
  updateByAdminTx: vi.mocked(repoMod.updateByAdminTx),
  deleteByAdminTx: vi.mocked(repoMod.deleteByAdminTx),
};

const employeeCtx = { userId: "u1", isOwner: false, permissionKeys: new Set<string>() };
const adminCtx = { userId: "admin1", isOwner: true, permissionKeys: new Set<string>() };

beforeEach(() => { vi.clearAllMocks(); holidays.mockResolvedValue(new Set()); getUnsyncedYears.mockResolvedValue([]); });

describe("createLeaveRequest", () => {
  const input = { leaveType: "ANNUAL" as const, startDate: "2999-08-14", endDate: "2999-08-14" };
  it("할당 없으면 LeaveValidationError", async () => {
    repo.findActiveAllocation.mockResolvedValue(null);
    await expect(createLeaveRequest("u1", input)).rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("중복이면 LeaveConflictError", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue({ id: "x" } as any);
    await expect(createLeaveRequest("u1", input)).rejects.toBeInstanceOf(LeaveConflictError);
  });
  it("잔여 부족해도 생성(마이너스 허용)", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 0, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", input);
    expect(repo.createPendingRequest).toHaveBeenCalledWith(expect.objectContaining({ days: 1 }));
  });
  it("과거 날짜 거부", async () => {
    await expect(createLeaveRequest("u1", { leaveType: "ANNUAL", startDate: "2000-01-01", endDate: "2000-01-01" }))
      .rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("필요 연도 공휴일 미적재면 차단(fail-closed)", async () => {
    getUnsyncedYears.mockResolvedValue([2999]);
    await expect(createLeaveRequest("u1", input)).rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("다년 범위는 중간 연도까지 게이트(inclusive enumeration)", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", { leaveType: "ANNUAL", startDate: "2999-12-31", endDate: "3001-01-02" });
    expect(getUnsyncedYears).toHaveBeenCalledWith([2999, 3000, 3001]);
  });
});

describe("cancel", () => {
  it("직원 본인 APPROVED 과거 → LeaveValidationError", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "u1", status: "APPROVED", startDate: new Date("2000-01-01T00:00:00Z") } as any);
    await expect(cancel("r1", employeeCtx, null)).rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("직원 본인 PENDING → cancelTx 호출", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "u1", status: "PENDING", startDate: new Date("2999-01-01T00:00:00Z") } as any);
    await cancel("r1", employeeCtx, "사유");
    expect(repo.cancelTx).toHaveBeenCalledWith("r1", "사유");
  });
  it("타인 신청을 일반 직원이 취소 → ForbiddenError", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "other", status: "PENDING", startDate: new Date("2999-01-01T00:00:00Z") } as any);
    await expect(cancel("r1", employeeCtx, null)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("관리자는 타인 APPROVED 과거도 취소 가능", async () => {
    repo.getRequestById.mockResolvedValue({ userId: "other", status: "APPROVED", startDate: new Date("2000-01-01T00:00:00Z") } as any);
    await cancel("r1", adminCtx, null);
    expect(repo.cancelTx).toHaveBeenCalled();
  });
});

describe("getRequest", () => {
  it("타인 신청을 권한 없이 조회 → ForbiddenError", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other" } as any);
    await expect(getRequest("r1", employeeCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
