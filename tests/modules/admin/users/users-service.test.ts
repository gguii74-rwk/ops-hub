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
// prisma 모킹 — services/index.ts의 upsertOverride·removeOverride가 withAvailabilityLock($transaction) 사용.
// F-Q: vi.hoisted로 stableTx를 팩토리 호이스팅 전에 생성해 $transaction 콜백이 받는 객체를 외부에서 참조 가능하게 한다.
// F-GG/F-FF: withAvailabilityLock의 advisory lock($executeRaw)·actor/target FOR UPDATE($queryRaw)·가드 team 읽기(user.findUnique).
const { stableTx } = vi.hoisted(() => ({
  stableTx: {
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    // F-HH: 가드가 in-tx actor systemRole/status/mustChangePassword를 읽는다(owner1→OWNER, 그 외→ADMIN, ACTIVE).
    user: { findUnique: vi.fn(async (a: { where: { id: string } }) => ({ systemRole: a.where.id === "owner1" ? "OWNER" : "ADMIN", status: "ACTIVE", mustChangePassword: false, teamId: null })) },
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(stableTx)) },
}));
// @/kernel/access — assertOverrideWithinActorGrant가 getEffectiveScope 호출.
vi.mock("@/kernel/access", () => ({
  getEffectiveScope: vi.fn(async () => "all"),
  SCOPE_RANK: { all: 3, team: 2, own: 1 },
}));

import {
  approveUser, rejectUser, createUserByAdmin, updateUser, assignRoles,
  upsertOverride, removeOverride, setUserStatus, resetPassword, getUserForEdit, listUsersForView,
} from "@/modules/admin/users/services";
import * as repo from "@/modules/admin/users/repositories";
import { triggerLeaveMailDrain } from "@/modules/leave/services/mail";
import { EscalationError, UserConflictError } from "@/modules/admin/users/errors";
import * as kernelAccess from "@/kernel/access";
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

// 낙관락: 라우트가 클라가 본 행 버전(expectedUpdatedAt)을 service에 넘긴다. repo CAS는 이 값(서버 재로드 target.updatedAt 아님)을 받는다.
const EXP = new Date("2026-06-01T00:00:00.000Z");

// getUserDetail 기본 응답 헬퍼(승인/거절·편집 대상).
const detail = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "u1", email: "u@x.com", name: "대상", status: "PENDING",
  employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", teamId: null, teamName: null,
  roleKeys: [] as string[], createdAt: new Date(), updatedAt: new Date("2026-06-01T00:00:00Z"),
  mustChangePassword: false, emailVerifiedAt: new Date(), overrides: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  r.getUserDetail.mockResolvedValue(detail() as never);
  // F-Q: stableTx.$queryRaw는 vi.clearAllMocks()로 초기화되므로 기본 resolved 구현을 복구한다.
  stableTx.$queryRaw.mockResolvedValue([]);
});

describe("approveUser", () => {
  const input = { employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const, systemRole: "MEMBER" as const, roleKeys: ["regular-developer"] };
  it("정상: approveTx(decision·mail[email]·expectedUpdatedAt(클라값)·recheck) 호출 + 메일 트리거", async () => {
    await approveUser(owner, "u1", input, EXP);
    expect(r.approveTx).toHaveBeenCalledWith(
      "u1", "owner1",
      expect.objectContaining({ systemRole: "MEMBER", roleKeys: ["regular-developer"] }),
      expect.objectContaining({ recipients: ["u@x.com"] }),
      EXP, // 클라가 본 버전(서버 재로드 target.updatedAt 아님)
      expect.any(Function), // NF2: recheck 콜백
    );
    expect(trigger).toHaveBeenCalled();
  });
  it("NF2: approveTx에 넘긴 recheck 콜백이 fresh 역할에 특권(pm)이 있으면 EscalationError를 던진다(위임 admin actor 기준)", async () => {
    // 위임 admin이 비특권 역할만 승인 시도 — 사전 검사는 통과. recheck는 actor를 캡처해 락 안 fresh로 재검사.
    await approveUser(delegate(), "u1", input, EXP);
    const recheck = r.approveTx.mock.calls[0][5] as (cur: string[]) => void;
    // 비특권만이면 통과
    expect(() => recheck(["regular-developer"])).not.toThrow();
    // 특권 역할(pm)이 fresh currentRoleKeys에 있으면 — 부여 목록에 없으므로 제거 시도가 되어 EscalationError
    expect(() => recheck(["pm", "regular-developer"])).toThrow(EscalationError);
  });
  it("대상 없음 → UserConflictError, approveTx 미호출", async () => {
    r.getUserDetail.mockResolvedValue(null);
    await expect(approveUser(owner, "u1", input, EXP)).rejects.toBeInstanceOf(UserConflictError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 승인 확정에서 특권 systemRole(ADMIN) 부여 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate(), "u1", { ...input, systemRole: "ADMIN" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 승인 확정에서 특권 역할(admin) 부여 → EscalationError, approveTx 미호출", async () => {
    await expect(approveUser(delegate(), "u1", { ...input, roleKeys: ["admin"] }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 자기 자신을 승인(자가 mutation) → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(approveUser(delegate([], "admin1"), "admin1", input, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.approveTx).not.toHaveBeenCalled();
  });
  it("finding J: 대상 name의 HTML이 승인 메일 bodyHtml에 escape되어 들어간다(stored injection 차단)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ name: "<script>alert(1)</script>" }) as never);
    await approveUser(owner, "u1", input, EXP);
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
    employmentType: "REGULAR" as const, jobFunction: "DEVELOPER" as const, teamId: null,
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
  it("email을 소문자로 정규화해 저장(병합 키 canonical — 공개 signup과 일관)", async () => {
    r.createActiveUserByAdminTx.mockResolvedValue({ id: "u-new" });
    await createUserByAdmin(owner, { ...input, email: "Mixed.Case@X.COM" });
    expect(r.createActiveUserByAdminTx).toHaveBeenCalledWith(expect.objectContaining({ email: "mixed.case@x.com" }));
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
  it("정상(비특권 patch): updateUserTx(patch·expectedUpdatedAt(클라값)) 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await updateUser(owner, "u1", { name: "수정" }, EXP);
    expect(r.updateUserTx).toHaveBeenCalledWith("u1", { name: "수정" }, "owner1", EXP);
  });
  it("위임 admin이 자기 자신 편집 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE" }) as never);
    await expect(updateUser(delegate([], "admin1"), "admin1", { name: "x" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 systemRole을 ADMIN으로 승격 → EscalationError(원하는 값이 특권)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    await expect(updateUser(delegate(), "u1", { systemRole: "ADMIN" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 OWNER 대상을 MEMBER로 강등 → EscalationError(현재 값이 특권 — finding C)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "OWNER" }) as never);
    await expect(updateUser(delegate(), "u1", { systemRole: "MEMBER" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 ADMIN 대상의 무관 속성만 편집(systemRole 미지정) → EscalationError(현재 특권은 보호)", async () => {
    // patch.systemRole 없음(null)이나 현재가 ADMIN이라 OWNER-only. 위임 admin이 특권 사용자를 못 만진다.
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "ADMIN" }) as never);
    await expect(updateUser(delegate(), "u1", { name: "수정" }, EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.updateUserTx).not.toHaveBeenCalled();
  });
});

describe("assignRoles (현재↔원하는 역할 집합 비교 — finding C)", () => {
  it("정상(비특권 역할 추가): 현재 [] → setRoles 호출(expectedUpdatedAt(클라값)·락 안 재검사 recheck 콜백 동반 — finding H)", async () => {
    await assignRoles(delegate(), "u1", ["regular-developer"], EXP);
    expect(r.setRoles).toHaveBeenCalledWith("u1", ["regular-developer"], "admin1", EXP, expect.any(Function));
  });
  it("finding H: setRoles에 넘긴 recheck 콜백이 락 안 fresh 역할로 가드를 재실행한다(stale 특권 부여 시 throw)", async () => {
    // 정상 호출로 setRoles에 전달된 recheck 클로저를 꺼내, 락 안에서 fresh로 pm이 관측됐다고 가정해 호출 → EscalationError.
    await assignRoles(delegate(), "u1", ["regular-developer"], EXP);
    const recheck = r.setRoles.mock.calls[0][4] as (cur: string[]) => void;
    expect(() => recheck(["pm", "regular-developer"])).toThrow(EscalationError); // fresh에 pm이 끼면 제거=특권 회수 거부
    expect(() => recheck([])).not.toThrow(); // fresh가 비특권만이면 통과
  });
  it("위임 admin이 특권 역할(pm) 부여 → EscalationError", async () => {
    await expect(assignRoles(delegate(), "u1", ["pm"], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
  it("위임 admin이 기존 pm을 목록에서 빼서 제거 → EscalationError(lockout 방지)", async () => {
    // 대상 현재 roleKeys=[pm, regular-developer] → next=[regular-developer]: pm 제거 = 특권 회수.
    r.getUserDetail.mockResolvedValue(detail({ roleKeys: ["pm", "regular-developer"] }) as never);
    await expect(assignRoles(delegate(), "u1", ["regular-developer"], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
  it("위임 admin이 비특권만 추가·제거(pm 그대로 유지) → 허용(특권 차집합 비어 있음)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ roleKeys: ["pm", "regular-developer"] }) as never);
    await assignRoles(delegate(), "u1", ["pm", "contractor-content"], EXP);
    expect(r.setRoles).toHaveBeenCalledWith("u1", ["pm", "contractor-content"], "admin1", EXP, expect.any(Function));
  });
  it("위임 admin이 자기 자신 역할 변경 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1" }) as never);
    await expect(assignRoles(delegate([], "admin1"), "admin1", ["regular-developer"], EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.setRoles).not.toHaveBeenCalled();
  });
});

describe("upsertOverride / removeOverride", () => {
  const ov = { resource: "leave.approval", action: "view", effect: "ALLOW" as const, scope: "all" as const, reason: null, startsAt: null, endsAt: null };
  it("ALLOW: actor 보유 권한이면 createOverride 호출", async () => {
    r.createOverride.mockResolvedValue({ id: "ov1" });
    const res = await upsertOverride(delegate(["leave.approval:view"]), "u1", ov);
    expect(res).toEqual({ id: "ov1" });
    expect(r.createOverride).toHaveBeenCalledWith("u1", expect.objectContaining({ resource: "leave.approval", action: "view", effect: "ALLOW" }), "admin1", expect.anything());
  });
  it("ALLOW: actor 미보유 권한이면 EscalationError, repo 미호출", async () => {
    // getEffectiveScope가 null 반환 → 미보유
    const { getEffectiveScope } = await import("@/kernel/access");
    vi.mocked(getEffectiveScope).mockResolvedValueOnce(null);
    await expect(upsertOverride(delegate([]), "u1", ov)).rejects.toBeInstanceOf(EscalationError);
    expect(r.createOverride).not.toHaveBeenCalled();
  });
  it("DENY: critical(admin.users:update)은 위임 admin 거부", async () => {
    await expect(upsertOverride(delegate(["admin.users:update"]), "u1", { ...ov, action: "update", resource: "admin.users", effect: "DENY" })).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 자기 자신 override → EscalationError", async () => {
    await expect(upsertOverride(delegate(["leave.approval:view"], "admin1"), "admin1", ov)).rejects.toBeInstanceOf(EscalationError);
  });
  it("NF2: 존재하지 않는 대상에 upsertOverride → UserConflictError, createOverride 미호출", async () => {
    r.getUserDetail.mockResolvedValue(null as never);
    await expect(upsertOverride(delegate(["leave.approval:view"]), "u-ghost", ov)).rejects.toBeInstanceOf(UserConflictError);
    expect(r.createOverride).not.toHaveBeenCalled();
  });
  it("removeOverride(비-critical DENY 삭제): 자가 아니고 grant 경계 통과면 deleteOverride 호출", async () => {
    // 삭제는 effect 반전: DENY 삭제=ALLOW 복원 → actor가 해당 권한 보유해야 함.
    r.getUserDetail.mockResolvedValue(detail({ overrides: [{ id: "ov1", resource: "leave.approval", action: "view", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }] }) as never);
    await removeOverride(delegate(["leave.approval:view"]), "u1", "ov1");
    expect(r.deleteOverride).toHaveBeenCalledWith("u1", "ov1", "admin1", expect.anything());
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
    // getEffectiveScope가 null → 미보유
    const { getEffectiveScope } = await import("@/kernel/access");
    vi.mocked(getEffectiveScope).mockResolvedValueOnce(null);
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
    expect(r.deleteOverride).toHaveBeenCalledWith("u1", "ov4", "owner1", expect.anything());
  });

  // F-Q (a): actor $queryRaw(FOR UPDATE 락)이 getEffectiveScope보다 먼저 호출되어야 한다(lock-before-guard 순서).
  it("F-Q (a) grant: $queryRaw(락)은 getEffectiveScope(가드)보다 먼저 호출된다", async () => {
    r.createOverride.mockResolvedValue({ id: "ov-fq" });
    const callLog: string[] = [];
    stableTx.$queryRaw.mockImplementation(async () => { callLog.push("queryRaw"); return []; });
    vi.mocked(kernelAccess.getEffectiveScope).mockImplementation(async () => { callLog.push("getEffectiveScope"); return "all"; });
    await upsertOverride(delegate(["leave.approval:view"]), "u1", ov);
    const qrIdx = callLog.indexOf("queryRaw");
    const gsIdx = callLog.indexOf("getEffectiveScope");
    expect(qrIdx).toBeGreaterThanOrEqual(0); // 실제로 호출됨
    expect(gsIdx).toBeGreaterThanOrEqual(0); // 실제로 호출됨
    expect(qrIdx).toBeLessThan(gsIdx);       // 락이 먼저
  });

  // F-Q (b): createOverride(grant)·deleteOverride(revoke)에 전달되는 tx는 $transaction 콜백이 받은 객체와 동일해야 한다.
  it("F-Q (b) grant: createOverride에 전달된 tx가 $transaction 콜백이 받은 stableTx와 동일 참조이다", async () => {
    r.createOverride.mockResolvedValue({ id: "ov-fq2" });
    await upsertOverride(delegate(["leave.approval:view"]), "u1", ov);
    // createOverride 마지막 인수(4번째)가 tx
    const callArgs = r.createOverride.mock.calls[0];
    const passedTx = callArgs[callArgs.length - 1];
    expect(passedTx).toBe(stableTx); // 새 $transaction이 중첩되지 않고 주입된 tx를 그대로 사용
  });

  it("F-Q (b) revoke: deleteOverride에 전달된 tx가 $transaction 콜백이 받은 stableTx와 동일 참조이다", async () => {
    r.getUserDetail.mockResolvedValue(detail({ overrides: [{ id: "ov-fq3", resource: "leave.approval", action: "view", effect: "DENY", scope: "all", reason: null, startsAt: null, endsAt: null }] }) as never);
    await removeOverride(delegate(["leave.approval:view"]), "u1", "ov-fq3");
    const callArgs = r.deleteOverride.mock.calls[0];
    const passedTx = callArgs[callArgs.length - 1];
    expect(passedTx).toBe(stableTx);
  });
});

describe("setUserStatus (finding 1 — 특권 대상 OWNER-only + 락 안 recheck)", () => {
  // F2 regression: PENDING/INVITED 사용자는 승인 플로우로만 처리해야 함 — status toggle 금지
  it("F2: target.status가 PENDING이면 UserConflictError, setStatusTx·reactivateRejectedTx 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "PENDING", systemRole: "MEMBER", roleKeys: [] }) as never);
    await expect(setUserStatus(owner, "u1", "ACTIVE", EXP)).rejects.toBeInstanceOf(UserConflictError);
    expect(r.setStatusTx).not.toHaveBeenCalled();
    expect(r.reactivateRejectedTx).not.toHaveBeenCalled();
  });
  it("F2: target.status가 INVITED이면 UserConflictError, setStatusTx·reactivateRejectedTx 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "INVITED", systemRole: "MEMBER", roleKeys: [] }) as never);
    await expect(setUserStatus(owner, "u1", "ACTIVE", EXP)).rejects.toBeInstanceOf(UserConflictError);
    expect(r.setStatusTx).not.toHaveBeenCalled();
    expect(r.reactivateRejectedTx).not.toHaveBeenCalled();
  });
  it("DISABLE(비특권 대상): setStatusTx(now·expectedUpdatedAt(클라값)·recheck) 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: [] }) as never);
    await setUserStatus(owner, "u1", "DISABLED", EXP);
    expect(r.setStatusTx).toHaveBeenCalledWith("u1", "DISABLED", "owner1", expect.any(Date), EXP, expect.any(Function));
  });
  it("REJECTED 대상에 ACTIVE → reactivateRejectedTx(expectedUpdatedAt(클라값)·recheck) 경로", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "REJECTED", systemRole: "MEMBER", roleKeys: [] }) as never);
    await setUserStatus(owner, "u1", "ACTIVE", EXP);
    expect(r.reactivateRejectedTx).toHaveBeenCalledWith("u1", "owner1", expect.any(Date), EXP, expect.any(Function));
    expect(r.setStatusTx).not.toHaveBeenCalled();
  });
  it("NF1: :approve 없는 위임 admin이 REJECTED→ACTIVE 재활성 → EscalationError, reactivateRejectedTx 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "REJECTED", systemRole: "MEMBER", roleKeys: [] }) as never);
    await expect(setUserStatus(delegate(["admin.users:update"]), "u1", "ACTIVE", EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.reactivateRejectedTx).not.toHaveBeenCalled();
  });
  it("NF1: :approve 보유 위임 admin이 REJECTED→ACTIVE 재활성 → reactivateRejectedTx 호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "REJECTED", systemRole: "MEMBER", roleKeys: [] }) as never);
    await setUserStatus(delegate(["admin.users:approve"]), "u1", "ACTIVE", EXP);
    expect(r.reactivateRejectedTx).toHaveBeenCalled();
  });
  it("위임 admin 자가 status 변경 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ id: "admin1", status: "ACTIVE" }) as never);
    await expect(setUserStatus(delegate([], "admin1"), "admin1", "DISABLED", EXP)).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 특권 대상(systemRole=ADMIN) 비활성화 → EscalationError, repo 미호출", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "ADMIN", roleKeys: [] }) as never);
    await expect(setUserStatus(delegate(), "u1", "DISABLED", EXP)).rejects.toBeInstanceOf(EscalationError);
    expect(r.setStatusTx).not.toHaveBeenCalled();
  });
  it("위임 admin이 특권 역할(pm) 보유 대상 비활성화 → EscalationError", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["pm"] }) as never);
    await expect(setUserStatus(delegate(), "u1", "DISABLED", EXP)).rejects.toBeInstanceOf(EscalationError);
  });
  it("위임 admin이 비특권 대상 비활성화 → 허용", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await setUserStatus(delegate(), "u1", "DISABLED", EXP);
    expect(r.setStatusTx).toHaveBeenCalled();
  });
  it("finding 1: setStatusTx에 넘긴 recheck가 락 안 fresh state로 특권 대상을 재거부", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: ["regular-developer"] }) as never);
    await setUserStatus(delegate(), "u1", "DISABLED", EXP);
    const recheck = r.setStatusTx.mock.calls[0][5] as (t: { systemRole: string; roleKeys: string[] }) => void;
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
  it("Finding E: 본인(OWNER 포함) self-reset은 EscalationError, resetPasswordTx 미호출 — change-password로 유도", async () => {
    // actor.userId === id 이면 OWNER여도 무조건 차단(임시비번 응답 유실 시 마지막 OWNER 락아웃 방지).
    // getUserDetail 호출 전에 던져야 하므로 mock 설정 불필요.
    await expect(resetPassword(owner, "owner1")).rejects.toBeInstanceOf(EscalationError);
    expect(r.resetPasswordTx).not.toHaveBeenCalled();
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

// ── 낙관락 회귀: stale updatedAt → repo CAS 0행 → UserConflictError(409) 전파 ──
// 서비스는 repo CAS 결과를 그대로 전파한다. 클라가 본 버전(EXP)이 다른 세션 변경으로 더 이상 일치하지 않으면 repo가
// UserConflictError를 던지고, 라우트가 409로 매핑한다(stale-tab lost-update가 silent 성공이 되지 않게 보장).
describe("낙관락 회귀: stale updatedAt → UserConflictError 전파(409)", () => {
  const conflict = new UserConflictError("처리 중 정보가 변경되었습니다. 다시 확인해 주세요.");
  it("updateUser: updateUserTx가 CAS 충돌(UserConflictError)이면 그대로 전파", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    r.updateUserTx.mockRejectedValueOnce(conflict);
    await expect(updateUser(owner, "u1", { name: "x" }, EXP)).rejects.toBeInstanceOf(UserConflictError);
  });
  it("assignRoles: setRoles가 CAS 충돌이면 그대로 전파(역할 동시변경 lost-update 차단)", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE" }) as never);
    r.setRoles.mockRejectedValueOnce(conflict);
    await expect(assignRoles(owner, "u1", ["regular-developer"], EXP)).rejects.toBeInstanceOf(UserConflictError);
  });
  it("setUserStatus: setStatusTx가 CAS 충돌이면 그대로 전파", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "ACTIVE", systemRole: "MEMBER", roleKeys: [] }) as never);
    r.setStatusTx.mockRejectedValueOnce(conflict);
    await expect(setUserStatus(owner, "u1", "DISABLED", EXP)).rejects.toBeInstanceOf(UserConflictError);
  });
  it("approveUser: approveTx가 CAS 충돌이면 그대로 전파", async () => {
    r.getUserDetail.mockResolvedValue(detail({ status: "PENDING" }) as never);
    r.approveTx.mockRejectedValueOnce(conflict);
    await expect(approveUser(owner, "u1", { employmentType: "REGULAR", jobFunction: "DEVELOPER", systemRole: "MEMBER", roleKeys: [] }, EXP)).rejects.toBeInstanceOf(UserConflictError);
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
