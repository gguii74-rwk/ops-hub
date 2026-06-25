import { describe, it, expect, vi, beforeEach } from "vitest";

// 메일 wiring(service→repo mailJob 전달·triggerLeaveMailDrain 호출·target 재검증)을 service 레벨로 검증.
// 수신자/트리거는 mock(부수효과 격리), repo도 mock해 mailJob 인자 shape를 단언한다. templates는 실제 사용.

const { getLeaveAdminRecipients, triggerLeaveMailDrain, userFindUnique, getSetting } = vi.hoisted(() => ({
  getLeaveAdminRecipients: vi.fn(async () => ["admin@x.com"] as string[]),
  triggerLeaveMailDrain: vi.fn(),
  userFindUnique: vi.fn(),
  getSetting: vi.fn(async () => true as unknown),
}));
vi.mock("@/modules/leave/services/mail", () => ({ getLeaveAdminRecipients, triggerLeaveMailDrain }));
vi.mock("@/kernel/settings/reader", () => ({ getSetting }));
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

// kernel/access mock: requirePermissionForTarget는 기본적으로 통과
const { requirePermissionForTarget } = vi.hoisted(() => ({
  requirePermissionForTarget: vi.fn(async () => {}),
}));
vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error {
    constructor(m = "권한이 없습니다.") { super(m); this.name = "ForbiddenError"; }
  },
  getEffectiveScope: vi.fn(async () => "all"),
  requirePermissionForTarget: (...a: unknown[]) => (requirePermissionForTarget as (...args: unknown[]) => unknown)(...a),
}));

import {
  createLeaveRequest, createLeaveRequestByAdmin, approve, reject,
} from "@/modules/leave/services/requests";
import { assertTargetUser } from "@/modules/leave/authz";
import { ForbiddenError } from "@/kernel/access";
import * as repoMod from "@/modules/leave/repositories";

const repo = {
  getRequestById: vi.mocked(repoMod.getRequestById),
  findActiveAllocation: vi.mocked(repoMod.findActiveAllocation),
  findOverlap: vi.mocked(repoMod.findOverlap),
  createPendingRequest: vi.mocked(repoMod.createPendingRequest),
  createApprovedRequestTx: vi.mocked(repoMod.createApprovedRequestTx),
  approveTx: vi.mocked(repoMod.approveTx),
  rejectRequest: vi.mocked(repoMod.rejectRequest),
};

const input = { leaveType: "ANNUAL" as const, startDate: "2999-08-14", endDate: "2999-08-14" };

beforeEach(() => {
  vi.clearAllMocks();
  getLeaveAdminRecipients.mockResolvedValue(["admin@x.com"]);
  userFindUnique.mockResolvedValue({ name: "직원", email: "u@x.com", status: "ACTIVE", teamId: "t1" });
  requirePermissionForTarget.mockResolvedValue(undefined);
  getSetting.mockResolvedValue(true);
});

describe("createLeaveRequest mail wiring", () => {
  it("REQUESTED mailJob(recipients 포함)과 함께 createPendingRequest 호출 + triggerLeaveMailDrain", async () => {
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", input);
    const [, mailJob] = repo.createPendingRequest.mock.calls[0];
    expect(mailJob).toEqual(expect.objectContaining({ recipients: ["admin@x.com"] }));
    expect(mailJob).toHaveProperty("bodyHtml");
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
    // getLeaveAdminRecipients는 applicantTeamId를 인자로 받음
    expect(getLeaveAdminRecipients).toHaveBeenCalledWith(expect.anything());
  });
  it("승인권한자 0명(recipients [])이어도 REQUESTED 행은 항상 적재(mailJob null 아님)", async () => {
    getLeaveAdminRecipients.mockResolvedValue([]);
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", input);
    const [, mailJob] = repo.createPendingRequest.mock.calls[0];
    expect(mailJob).not.toBeNull();
    expect(mailJob).toEqual(expect.objectContaining({ recipients: [] }));
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("onRequest OFF → mailJob null + createPendingRequest(null) + triggerLeaveMailDrain 미호출", async () => {
    getSetting.mockResolvedValue(false);
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", input);
    const [, mailJob] = repo.createPendingRequest.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(getSetting).toHaveBeenCalledWith("leave.notifications.onRequest");
    expect(triggerLeaveMailDrain).not.toHaveBeenCalled();
  });
  it("getSetting 조회 예외(인프라 장애) → fail-closed로 미발송(D4 개정)", async () => {
    getSetting.mockRejectedValue(new Error("settings DB down"));
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", input);
    const [, mailJob] = repo.createPendingRequest.mock.calls[0];
    expect(mailJob).toBeNull(); // 조회 예외 → 미발송(fail-closed). "미설정 행 → default ON"은 별개(getSetting이 default true 반환, 예외 아님)
    expect(triggerLeaveMailDrain).not.toHaveBeenCalled();
  });
});

describe("createLeaveRequestByAdmin mail wiring", () => {
  it("sendNotification=false → mailJob null, triggerLeaveMailDrain 미호출", async () => {
    repo.findOverlap.mockResolvedValue(null);
    repo.createApprovedRequestTx.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequestByAdmin("admin1", "u2", input, null, false);
    const [, mailJob] = repo.createApprovedRequestTx.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(triggerLeaveMailDrain).not.toHaveBeenCalled();
  });
  it("sendNotification=true → ADMIN_CREATED mailJob(대상 이메일) + triggerLeaveMailDrain", async () => {
    repo.findOverlap.mockResolvedValue(null);
    repo.createApprovedRequestTx.mockResolvedValue({ id: "r1" } as any);
    userFindUnique.mockResolvedValue({ email: "target@x.com", status: "ACTIVE", teamId: "t1" });
    await createLeaveRequestByAdmin("admin1", "u2", input, null, true);
    const [, mailJob] = repo.createApprovedRequestTx.mock.calls[0];
    expect(mailJob).toEqual(expect.objectContaining({ recipients: ["target@x.com"] }));
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("관리자 직접등록은 토글 무관 — getSetting 미조회(D3), sendNotification만 따름", async () => {
    getSetting.mockResolvedValue(false); // 토글 OFF여도
    repo.findOverlap.mockResolvedValue(null);
    repo.createApprovedRequestTx.mockResolvedValue({ id: "r1" } as any);
    userFindUnique.mockResolvedValue({ email: "target@x.com", status: "ACTIVE", teamId: "t1" });
    await createLeaveRequestByAdmin("admin1", "u2", input, null, true);
    const [, mailJob] = repo.createApprovedRequestTx.mock.calls[0];
    expect(mailJob).toEqual(expect.objectContaining({ recipients: ["target@x.com"] }));
    expect(getSetting).not.toHaveBeenCalled();
  });
});

describe("approve/reject mail wiring (pre-flight #4)", () => {
  it("approve → requirePermissionForTarget 호출 후 approveTx에 APPROVED mailJob + authz 전달 + triggerLeaveMailDrain", async () => {
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    repo.approveTx.mockResolvedValue(undefined as any);
    await approve("r1", "admin1");
    expect(requirePermissionForTarget).toHaveBeenCalledWith("admin1", "leave.approval", "approve", { teamId: "t1" });
    const [reqId, adminId, mailJob, authz] = repo.approveTx.mock.calls[0];
    expect(reqId).toBe("r1");
    expect(adminId).toBe("admin1");
    expect(mailJob).toEqual(expect.objectContaining({ recipients: ["u@x.com"] }));
    expect(authz).toEqual({ actorId: "admin1", applicantId: "u1" });
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("reject → requirePermissionForTarget 호출 후 rejectRequest에 REJECTED mailJob + authz 전달 + triggerLeaveMailDrain", async () => {
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    repo.rejectRequest.mockResolvedValue(undefined as any);
    await reject("r1", "admin1", "사유");
    expect(requirePermissionForTarget).toHaveBeenCalledWith("admin1", "leave.approval", "approve", { teamId: "t1" });
    const [reqId, adminId, reason, mailJob, authz] = repo.rejectRequest.mock.calls[0];
    expect(reqId).toBe("r1");
    expect(adminId).toBe("admin1");
    expect(reason).toBe("사유");
    expect(mailJob).toEqual(expect.objectContaining({ recipients: ["u@x.com"] }));
    expect(authz).toEqual({ actorId: "admin1", applicantId: "u1" });
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("신청자 이메일 없으면 mailJob null이지만 triggerLeaveMailDrain은 호출(backstop)", async () => {
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: null, teamId: null });
    repo.approveTx.mockResolvedValue(undefined as any);
    await approve("r1", "admin1");
    const [, , mailJob] = repo.approveTx.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("requirePermissionForTarget가 ForbiddenError → approve 실패", async () => {
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    requirePermissionForTarget.mockRejectedValueOnce(new ForbiddenError("팀 외"));
    await expect(approve("r1", "admin1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.approveTx).not.toHaveBeenCalled();
  });
  it("onApprove OFF → approveTx에 mailJob null(triggerLeaveMailDrain backstop 호출은 유지)", async () => {
    getSetting.mockResolvedValue(false);
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    repo.approveTx.mockResolvedValue(undefined as any);
    await approve("r1", "admin1");
    const [, , mailJob] = repo.approveTx.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(getSetting).toHaveBeenCalledWith("leave.notifications.onApprove");
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("onReject OFF → rejectRequest에 mailJob null(triggerLeaveMailDrain 유지)", async () => {
    getSetting.mockResolvedValue(false);
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    repo.rejectRequest.mockResolvedValue(undefined as any);
    await reject("r1", "admin1", "사유");
    const [, , , mailJob] = repo.rejectRequest.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(getSetting).toHaveBeenCalledWith("leave.notifications.onReject");
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
});

describe("assertTargetUser", () => {
  it("없는 사용자면 ForbiddenError", async () => {
    userFindUnique.mockResolvedValue(null);
    await expect(assertTargetUser("ghost")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("비활성 사용자면 ForbiddenError", async () => {
    userFindUnique.mockResolvedValue({ status: "INACTIVE" });
    await expect(assertTargetUser("u1")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("ACTIVE면 통과", async () => {
    userFindUnique.mockResolvedValue({ status: "ACTIVE" });
    await expect(assertTargetUser("u1")).resolves.toBeUndefined();
  });
});
