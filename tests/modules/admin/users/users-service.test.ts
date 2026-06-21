import { describe, it, expect, vi, beforeEach } from "vitest";

// repository(S6) 모킹.
vi.mock("@/modules/admin/users/repositories", () => ({
  getUserDetail: vi.fn(), listUsers: vi.fn(),
  approveTx: vi.fn(), rejectTx: vi.fn(), createActiveUserByAdminTx: vi.fn(),
  updateUserTx: vi.fn(), setRoles: vi.fn(), createOverride: vi.fn(), deleteOverride: vi.fn(),
  setStatusTx: vi.fn(), reactivateRejectedTx: vi.fn(), resetPasswordTx: vi.fn(),
}));
// 메일 트리거(공통) — no-op.
vi.mock("@/modules/leave/services/mail", () => ({ triggerLeaveMailDrain: vi.fn() }));
// bcrypt 해시 — 고정값(임시비번/새 비번 해시는 서비스가 만든다).
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "HASHED") } }));

import {
  approveUser, rejectUser, createUserByAdmin, updateUser, assignRoles,
  upsertOverride, removeOverride, setUserStatus, resetPassword, getUserForEdit, listUsersForView,
} from "@/modules/admin/users/services";
import * as repo from "@/modules/admin/users/repositories";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { EscalationError, UserConflictError } from "@/modules/admin/users/errors";
import type { ActorContext } from "@/modules/admin/users/services/guards";

const r = {
  getUserDetail: vi.mocked(repo.getUserDetail),
  listUsers: vi.mocked(repo.listUsers),
  approveTx: vi.mocked(repo.approveTx),
  rejectTx: vi.mocked(repo.rejectTx),
  createActiveUserByAdminTx: vi.mocked(repo.createActiveUserByAdminTx),
  updateUserTx: vi.mocked(repo.updateUserTx),
  setRoles: vi.mocked(repo.setRoles),
  createOverride: vi.mocked(repo.createOverride),
  deleteOverride: vi.mocked(repo.deleteOverride),
  setStatusTx: vi.mocked(repo.setStatusTx),
  reactivateRejectedTx: vi.mocked(repo.reactivateRejectedTx),
  resetPasswordTx: vi.mocked(repo.resetPasswordTx),
};
const trigger = vi.mocked(triggerLeaveMailDrain);

const owner: ActorContext = { userId: "owner1", isOwner: true, permissionKeys: new Set() };
const delegate = (keys: string[] = [], id = "admin1"): ActorContext => ({ userId: id, isOwner: false, permissionKeys: new Set(keys) });

// getUserDetail 기본 응답 헬퍼(승인/거절·편집 대상).
const detail = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "u1", email: "u@x.com", name: "대상", status: "PENDING",
  employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", department: null,
  roleKeys: [] as string[], createdAt: new Date(), updatedAt: new Date("2026-06-01T00:00:00Z"),
  mustChangePassword: false, emailVerifiedAt: new Date(), overrides: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  r.getUserDetail.mockResolvedValue(detail() as never);
});

describe("approveUser", () => {
  const input = { employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const, systemRole: "MEMBER" as const, roleKeys: ["regular-developer"] };
  it("정상: approveTx(decision·mail[email]·updatedAt) 호출 + 메일 트리거", async () => {
    await approveUser(owner, "u1", input);
    expect(r.approveTx).toHaveBeenCalledWith(
      "u1", "owner1",
      expect.objectContaining({ systemRole: "MEMBER", roleKeys: ["regular-developer"] }),
      expect.objectContaining({ recipients: ["u@x.com"] }),
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(trigger).toHaveBeenCalled();
  });
  it("대상 없음 → UserConflictError, approveTx 미호출", async () => {
    r.getUserDetail.mockResolvedValue(null);
    await expect(approveUser(owner, "u1", input)).rejects.toBeInstanceOf(UserConflictError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 승인 확정에서 특권 systemRole(ADMIN) 부여 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate(), "u1", { ...input, systemRole: "ADMIN" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 승인 확정에서 특권 역할(admin) 부여 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate(), "u1", { ...input, roleKeys: ["admin"] })).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 자기 자신을 승인(자가 mutation) → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(approveUser(delegate([], "admin1"), "admin1", input)).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("finding J: 대상 name의 HTML이 승인 메일 bodyHtml에 escape되어 들어간다(stored injection 차단)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ name: "<script>alert(1)</script>" }) as never);
    await approveUser(owner, "u1", input);
    const mailArg = r.approveTx.mock.calls[0][3] as { bodyHtml: string };
    expect(mailArg.bodyHtml).not.toContain("<script>");
    expect(mailArg.bodyHtml).toContain("&lt;script&gt;");
  });
});

describe("rejectUser", () => {
  it("정상: rejectTx(reason·mail[email]·updatedAt) + 트리거", async () => {
    await rejectUser(owner, "u1", "중복");
    expect(r.rejectTx).toHaveBeenCalledWith("u1", "owner1", "중복", expect.objectContaining({ recipients: ["u@x.com"] }), new Date("2026-06-01T00:00:00Z"));
    expect(trigger).toHaveBeenCalled();
  });
  it("위임 admin 자가 거절 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(rejectUser(delegate([], "admin1"), "admin1", "x")).rejects.toBeInstanceOf(EscalationError);
  });
  it("finding J: reason의 HTML이 거절 메일 bodyHtml에 escape된다", async () => {
    await rejectUser(owner, "u1", "<img src=x onerror=alert(1)>");
    const mailArg = r.rejectTx.mock.calls[0][3] as { bodyHtml: string };
    expect(mailArg.bodyHtml).not.toContain("<img");
    expect(mailArg.bodyHtml).toContain("&lt;img");
  });
});

describe("createUserByAdmin", () => {
  const input = {
    email: "n@x.com", name: "신규", password: "abcdefghijkl",
    employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const, department: null,
    systemRole: "MEMBER" as const, roleKeys: ["regular-developer"],
  };
  it("정상: 비번 해시 후 createActiveUserByAdminTx(passwordHash) 호출", async () => {
    r.createActiveUserByAdminTx.mockResolvedValue({ id: "u-new" });
    const res = await createUserByAdmin(owner, input);
    expect(res).toEqual({ id: "u-new" });
    expect(r.createActiveUserByAdminTx).toHaveBeenCalledWith(expect.objectContaining({
      email: "n@x.com", passwordHash: "HASHED", systemRole: "MEMBER", actorId: "owner1", roleKeys: ["regular-developer"],
    }));
  });
  it("위임 admin이 특권 systemRole(OWNER) 직접추가 → EscalationError, repo 미호출", async () => {
    await expect(createUserByAdmin(delegate(), { ...input, systemRole: "OWNER" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.createActiveUserByAdminTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 특권 역할(pm) 직접추가 → EscalationError, repo 미호출", async () => {
    await expect(createUserByAdmin(delegate(), { ...input, roleKeys: ["pm"] })).rejects.toBeInstanceOf(EscalationError);
    expect(r.createActiveUserByAdminTx).not.toHaveBeenCalled();
  });
});

describe("updateUser", () => {
  it("정상(비특권 patch): updateUserTx(patch·updatedAt) 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await updateUser(owner, "u1", { name: "수정" });
    expect(r.updateUserTx).toHaveBeenCalledWith("u1", { name: "수정" }, "owner1", new Date("2026-06-01T00:00:00Z"));
  });
  it("위임 admin이 자기 자신 편집 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE" }) as never);
    await expect(updateUser(delegate([], "admin1"), "admin1", { name: "x" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 systemRole을 ADMIN으로 승격 → EscalationError(원하는 값이 특권)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await expect(updateUser(delegate(), "u1", { systemRole: "ADMIN" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 OWNER 대상을 MEMBER로 강등 → EscalationError(현재 값이 특권 — finding C)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "OWNER" }) as never);
    await expect(updateUser(delegate(), "u1", { systemRole: "MEMBER" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 ADMIN 대상의 무관 속성만 편집(systemRole 미지정) → EscalationError(현재 특권은 보호)", async () => {
    // patch.systemRole 없음(null)이나 현재가 ADMIN이라 OWNER-only. 위임 admin이 특권 사용자를 못 만진다.
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "ADMIN" }) as never);
    await expect(updateUser(delegate(), "u1", { name: "수정" })).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
});

describe("assignRoles (현재↔원하는 역할 집합 비교 — finding C)", () => {
  it("정상(비특권 역할 추가): 현재 [] → setRoles 호출(락 안 재검사 recheck 콜백 동반 — finding H)", async () => {
    await assignRoles(delegate(), "u1", ["regular-developer"]);
    expect(r.setRoles).toHaveBeenCalledWith("u1", ["regular-developer"], "admin1", expect.any(Function));
  });
  it("finding H: setRoles에 넘긴 recheck 콜백이 락 안 fresh 역할로 가드를 재실행한다(stale 특권 부여 시 throw)", async () => {
    // 정상 호출로 setRoles에 전달된 recheck 클로저를 꺼내, 락 안에서 fresh로 pm이 관측됐다고 가정해 호출 → EscalationError.
    await assignRoles(delegate(), "u1", ["regular-developer"]);
    const recheck = r.setRoles.mock.calls[0][3] as (cur: string[]) => void;
    expect(() => recheck(["pm", "regular-developer"])).toThrow(EscalationError); // fresh에 pm이 끼면 제거=특권 회수 거부
    expect(() => recheck([])).not.toThrow(); // fresh가 비특권만이면 통과
  });
  it("위임 admin이 특권 역할(pm) 부여 → EscalationError", async () => {
    await expect(assignRoles(delegate(), "u1", ["pm"])).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 pm을 목록에서 빼서 제거 → EscalationError(lockout 방지)", async () => {
    // 대상 현재 roleKeys=[pm, regular-developer] → next=[regular-developer]: pm 제거 = 특권 회수.
    r.getUserDetail.mockResolvedValue(detail({ roleKeys: ["pm", "regular-developer"] }) as never);
    await expect(assignRoles(delegate(), "u1", ["regular-developer"])).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
  it("위임 admin이 비특권만 추가·제거(pm 그대로 유지) → 허용(특권 차집합 비어 있음)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ roleKeys: ["pm", "regular-developer"] }) as never);
    await assignRoles(delegate(), "u1", ["pm", "contractor-content"]);
    expect(r.setRoles).toHaveBeenCalledWith("u1", ["pm", "contractor-content"], "admin1", expect.any(Function));
  });
  it("위임 admin이 자기 자신 역할 변경 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(assignRoles(delegate([], "admin1"), "admin1", ["regular-developer"])).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
});

describe("upsertOverride / removeOverride", () => {
  const ov = { resource: "leave.approval", action: "view", effect: "ALLOW" as const, scope: "all" as const, reason: null, startsAt: null, endsAt: null };
  it("ALLOW: actor 보유 권한이면 createOverride 호출", async () => {
    r.createOverride.mockResolvedValue({ id: "ov1" });
    const res = await upsertOverride(delegate(["leave.approval:view"]), "u1", ov);
    expect(res).toEqual({ id: "ov1" });
    expect(r.createOverride).toHaveBeenCalledWith("u1", expect.objectContaining({ resource: "leave.approval", action: "view", effect: "ALLOW" }), "admin1");
  });
  it("ALLOW: actor 미보유 권한이면 EscalationError, repo 미호출", async () => {
    await expect(upsertOverride(delegate([]), "u1", ov)).rejects.toBeInstanceOf(EscalationError);
    expect(r.createOverride).not.toHaveBeenCalled();
  });
  it("DENY: critical(admin.users:update)은 위임 admin 거부", async () => {
    await expect(upsertOverride(delegate(["admin.users:update"]), "u1", { ...ov, action: "update", resource: "admin.users", effect: "DENY" })).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 자기 자신 override → EscalationError", async () => {
    await expect(upsertOverride(delegate(["leave.approval:view"], "admin1"), "admin1", ov)).rejects.toBeInstanceOf(EscalationError);
  });
  it("removeOverride(비-critical DENY 삭제): 자가 아니고 grant 경계 통과면 deleteOverride 호출", async () => {
    // 삭제는 effect 반전: DENY 삭제=ALLOW 복원 → actor가 해당 권한 보유해야 함.
    r.getUserDetail.mockResolvedValue(detail({ overrides: [{ id: "ov1", resource: "leave.approval", action: "view", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }] }) as never);
    await removeOverride(delegate(["leave.approval:view"]), "u1", "ov1");
    expect(r.deleteOverride).toHaveBeenCalledWith("u1", "ov1", "admin1");
  });
  it("removeOverride: 자가 mutation 거부", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(removeOverride(delegate([], "admin1"), "admin1", "ov1")).rejects.toBeInstanceOf(EscalationError);
    expect(r.deleteOverride).not.toHaveBeenCalled();
  });
  it("finding 2: 위임 admin이 critical(admin.users:update) DENY override 삭제 → EscalationError, repo 미호출", async () => {
    // critical DENY 삭제 = 대상의 admin 권한 복원 → OWNER-only(effect 무관). 보유 여부와 무관하게 거부.
    r.getUserDetail.mockResolvedValue(detail({ overrides: [{ id: "ov2", resource: "admin.users", action: "update", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }] }) as never);
    await expect(removeOverride(delegate(["admin.users:update"]), "u1", "ov2")).rejects.toBeInstanceOf(EscalationError);
    expect(r.deleteOverride).not.toHaveBeenCalled();
  });
  it("finding 2: 비-critical DENY 삭제인데 actor가 해당 권한 미보유 → EscalationError(복원 권한 없음)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ overrides: [{ id: "ov3", resource: "leave.approval", action: "view", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }] }) as never);
    await expect(removeOverride(delegate([]), "u1", "ov3")).rejects.toBeInstanceOf(EscalationError);
    expect(r.deleteOverride).not.toHaveBeenCalled();
  });
  it("removeOverride: 없는 overrideId면 UserConflictError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ overrides: [] }) as never);
    await expect(removeOverride(delegate(), "u1", "ghost")).rejects.toBeInstanceOf(UserConflictError);
  });
  it("OWNER는 critical DENY override 삭제 허용", async () => {
    r.getUserDetail.mockResolvedValue(detail({ overrides: [{ id: "ov4", resource: "admin.users", action: "update", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }] }) as never);
    await removeOverride(owner, "u1", "ov4");
    expect(r.deleteOverride).toHaveBeenCalledWith("u1", "ov4", "owner1");
  });
});

describe("setUserStatus (finding 1 — 특권 대상 OWNER-only + 락 안 recheck)", () => {
  it("DISABLE(비특권 대상): setStatusTx(now·recheck) 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: [] }) as never);
    await setUserStatus(owner, "u1", "DISABLED");
    expect(r.setStatusTx).toHaveBeenCalledWith("u1", "DISABLED", "owner1", expect.any(Date), expect.any(Function));
  });
  it("REJECTED 대상에 ACTIVE → reactivateRejectedTx(recheck) 경로", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "REJECTED", systemRole: "MEMBER", roleKeys: [] }) as never);
    await setUserStatus(owner, "u1", "ACTIVE");
    expect(r.reactivateRejectedTx).toHaveBeenCalledWith("u1", "owner1", expect.any(Date), expect.any(Function));
    expect(r.setStatusTx).not.toHaveBeenCalled();
  });
  it("위임 admin 자가 status 변경 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE" }) as never);
    await expect(setUserStatus(delegate([], "admin1"), "admin1", "DISABLED")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 특권 대상(systemRole=ADMIN) 비활성화 → EscalationError, repo 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "ADMIN", roleKeys: [] }) as never);
    await expect(setUserStatus(delegate(), "u1", "DISABLED")).rejects.toBeInstanceOf(EscalationError);
    expect(r.setStatusTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 특권 역할(pm) 보유 대상 비활성화 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["pm"] }) as never);
    await expect(setUserStatus(delegate(), "u1", "DISABLED")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비특권 대상 비활성화 → 허용", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await setUserStatus(delegate(), "u1", "DISABLED");
    expect(r.setStatusTx).toHaveBeenCalled();
  });
  it("finding 1: setStatusTx에 넘긴 recheck가 락 안 fresh state로 특권 대상을 재거부", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await setUserStatus(delegate(), "u1", "DISABLED");
    const recheck = r.setStatusTx.mock.calls[0][4] as (t: { systemRole: string; roleKeys: string[] }) => void;
    expect(() => recheck({ systemRole: "ADMIN", roleKeys: [] })).toThrow(EscalationError);
    expect(() => recheck({ systemRole: "MEMBER", roleKeys: ["regular-developer"] })).not.toThrow();
  });
});

describe("resetPassword (D14 — 특권 대상 OWNER-only)", () => {
  it("OWNER가 비특권 대상 재설정 → 임시비번 해시 후 resetPasswordTx + 결과 반환(임시비번 전달용·락 안 recheck 동반)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: [] }) as never);
    const res = await resetPassword(owner, "u1");
    expect(typeof res.temporaryPassword).toBe("string");
    expect(res.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(r.resetPasswordTx).toHaveBeenCalledWith("u1", "HASHED", "owner1", expect.any(Date), expect.any(Function));
  });
  it("finding H: resetPasswordTx에 넘긴 recheck가 락 안 fresh state로 특권 대상을 재거부한다", async () => {
    // 위임 admin이 비특권 대상으로 사전 검사를 통과해도, 락 안에서 fresh로 특권(ADMIN)이 관측되면 recheck가 EscalationError.
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await resetPassword(delegate(), "u1");
    const recheck = r.resetPasswordTx.mock.calls[0][4] as (t: { systemRole: string; roleKeys: string[] }) => void;
    expect(() => recheck({ systemRole: "ADMIN", roleKeys: [] })).toThrow(EscalationError);
    expect(() => recheck({ systemRole: "MEMBER", roleKeys: ["pm"] })).toThrow(EscalationError); // 특권 역할 보유도 거부
    expect(() => recheck({ systemRole: "MEMBER", roleKeys: ["regular-developer"] })).not.toThrow();
  });
  it("위임 admin이 특권 대상(systemRole=ADMIN) 재설정 → EscalationError, repo 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "ADMIN", roleKeys: [] }) as never);
    await expect(resetPassword(delegate(), "u1")).rejects.toBeInstanceOf(EscalationError);
    expect(r.resetPasswordTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 특권 역할(pm) 보유 대상 재설정 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["pm"] }) as never);
    await expect(resetPassword(delegate(), "u1")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 자기 자신 admin 라우트로 재설정 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE", systemRole: "MEMBER" }) as never);
    await expect(resetPassword(delegate([], "admin1"), "admin1")).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비특권 대상 재설정 → 허용", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await resetPassword(delegate(), "u1");
    expect(r.resetPasswordTx).toHaveBeenCalled();
  });
});

describe("getUserForEdit / listUsersForView (단순 위임)", () => {
  it("getUserForEdit: 대상 없으면 null", async () => {
    r.getUserDetail.mockResolvedValue(null);
    expect(await getUserForEdit(owner, "u1")).toBeNull();
  });
  it("listUsersForView: repo.listUsers로 위임", async () => {
    r.listUsers.mockResolvedValue({ rows: [], total: 0, pendingCount: 0 } as never);
    const res = await listUsersForView(owner, { page: 1, pageSize: 20 });
    expect(res).toEqual({ rows: [], total: 0, pendingCount: 0 });
    expect(r.listUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });
});
