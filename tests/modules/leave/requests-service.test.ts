import { describe, it, expect, vi, beforeEach } from "vitest";

// 신청자/대상 이메일·이름 조회용 user.findUnique를 가진 fake prisma.
const { userFindUnique } = vi.hoisted(() => ({ userFindUnique: vi.fn((..._a: unknown[]) => Promise.resolve({ name: "직원", email: "u@x.com" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } } }));
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
// 메일 wiring은 mail-wiring.test.ts에서 상세 검증 — 여기선 기존 케이스 무손상용으로 no-op 모킹.
vi.mock("@/modules/leave/services/mail", () => ({
  getLeaveAdminRecipients: vi.fn(async () => ["admin@x.com"]),
  triggerLeaveMailDrain: vi.fn(),
}));
vi.mock("@/modules/leave/authz", () => ({ assertTargetUser: vi.fn(async () => {}) }));

import { createLeaveRequest, createLeaveRequestByAdmin, cancel, getRequest, updateByAdmin } from "@/modules/leave/services/requests";
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

beforeEach(() => {
  vi.clearAllMocks();
  holidays.mockResolvedValue(new Set());
  getUnsyncedYears.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({ name: "직원", email: "u@x.com" });
});

describe("createLeaveRequest", () => {
  const input = { leaveType: "ANNUAL" as const, startDate: "2999-08-14", endDate: "2999-08-14" };
  it("할당 없으면 LeaveValidationError", async () => {
    getUnsyncedYears.mockResolvedValue([]);
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
    expect(repo.createPendingRequest).toHaveBeenCalledWith(expect.objectContaining({ days: 1 }), expect.anything());
  });
  it("과거 날짜 거부", async () => {
    await expect(createLeaveRequest("u1", { leaveType: "ANNUAL", startDate: "2000-01-01", endDate: "2000-01-01" }))
      .rejects.toBeInstanceOf(LeaveValidationError);
  });
  it("필요 연도 공휴일 미적재면 차단(fail-closed)", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
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

describe("createLeaveRequestByAdmin", () => {
  const input = { leaveType: "ANNUAL" as const, startDate: "2999-08-14", endDate: "2999-08-14" };
  it("미적재 연도 → warn-only, createApprovedRequestTx 호출(관리자 override)", async () => {
    getUnsyncedYears.mockResolvedValue([2999]);
    repo.findOverlap.mockResolvedValue(null);
    repo.createApprovedRequestTx.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequestByAdmin("admin1", "u2", input);
    expect(repo.createApprovedRequestTx).toHaveBeenCalledWith(expect.objectContaining({ userId: "u2" }), null);
  });
});

describe("updateByAdmin (effective-state 교차검증)", () => {
  const existingAnnual = {
    id: "r1", userId: "u1", status: "PENDING", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
    startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), days: 1, reason: null,
  };
  it("ANNUAL→HALF인데 leaveSubType 미전달 → LeaveValidationError, updateByAdminTx 미호출", async () => {
    repo.getRequestById.mockResolvedValue({ ...existingAnnual } as any);
    await expect(updateByAdmin("r1", { leaveType: "HALF" }, "admin1")).rejects.toBeInstanceOf(LeaveValidationError);
    expect(repo.updateByAdminTx).not.toHaveBeenCalled();
  });
  it("ANNUAL→QUARTER인데 quarterStartTime 미전달 → LeaveValidationError", async () => {
    repo.getRequestById.mockResolvedValue({ ...existingAnnual } as any);
    await expect(updateByAdmin("r1", { leaveType: "QUARTER" }, "admin1")).rejects.toBeInstanceOf(LeaveValidationError);
    expect(repo.updateByAdminTx).not.toHaveBeenCalled();
  });
  it("QUARTER인데 비화이트리스트 시각 → LeaveValidationError", async () => {
    repo.getRequestById.mockResolvedValue({ ...existingAnnual } as any);
    await expect(updateByAdmin("r1", { leaveType: "QUARTER", quarterStartTime: "08:00" }, "admin1")).rejects.toBeInstanceOf(LeaveValidationError);
    expect(repo.updateByAdminTx).not.toHaveBeenCalled();
  });
  it("HALF+leaveSubType 정상 → updateByAdminTx(adminId·effective값) 호출", async () => {
    repo.getRequestById.mockResolvedValue({ ...existingAnnual } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.updateByAdminTx.mockResolvedValue({ id: "r1" } as any);
    await updateByAdmin("r1", { leaveType: "HALF", leaveSubType: "MORNING" }, "admin1");
    expect(repo.updateByAdminTx).toHaveBeenCalledWith("r1", expect.objectContaining({
      adminId: "admin1", leaveType: "HALF", leaveSubType: "MORNING", quarterStartTime: null,
    }));
  });
  it("QUARTER+화이트리스트 시각 정상 → updateByAdminTx 호출", async () => {
    repo.getRequestById.mockResolvedValue({ ...existingAnnual } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.updateByAdminTx.mockResolvedValue({ id: "r1" } as any);
    await updateByAdmin("r1", { leaveType: "QUARTER", quarterStartTime: "09:00" }, "admin1");
    expect(repo.updateByAdminTx).toHaveBeenCalledWith("r1", expect.objectContaining({
      adminId: "admin1", leaveType: "QUARTER", quarterStartTime: "09:00", leaveSubType: null,
    }));
  });
});

describe("getRequest", () => {
  const approverCtx = { userId: "ap", isOwner: false, permissionKeys: new Set(["leave.approval:view"]) };
  const adminViewCtx = { userId: "av", isOwner: false, permissionKeys: new Set(["leave.admin:view"]) };

  it("타인 신청을 권한 없이 조회 → ForbiddenError", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other", status: "PENDING" } as any);
    await expect(getRequest("r1", employeeCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("본인 신청은 상태 무관 조회 가능", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "u1", status: "REJECTED" } as any);
    await expect(getRequest("r1", employeeCtx)).resolves.toMatchObject({ id: "r1" });
  });
  it("approval:view는 타인 PENDING(승인 큐) 조회 가능", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other", status: "PENDING" } as any);
    await expect(getRequest("r1", approverCtx)).resolves.toMatchObject({ id: "r1" });
  });
  it("approval:view가 타인 non-PENDING(APPROVED) 조회 → ForbiddenError(읽기-전체 자격 아님)", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other", status: "APPROVED" } as any);
    await expect(getRequest("r1", approverCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("admin:view는 타인 전 상태(APPROVED 등) 조회 가능", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other", status: "APPROVED" } as any);
    await expect(getRequest("r1", adminViewCtx)).resolves.toMatchObject({ id: "r1" });
  });
  it("시스템 OWNER는 타인 전 상태 조회 가능", async () => {
    repo.getRequestById.mockResolvedValue({ id: "r1", userId: "other", status: "CANCELLED" } as any);
    await expect(getRequest("r1", adminCtx)).resolves.toMatchObject({ id: "r1" });
  });
});
