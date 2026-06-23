import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    accessRole: { findUnique: vi.fn() },
    permission: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
const access = vi.hoisted(() => ({ requirePermission: vi.fn(), setCell: vi.fn() }));
vi.mock("@/kernel/access", async (orig) => ({ ...(await orig()), requirePermission: access.requirePermission }));
vi.mock("@/modules/admin/roles/repositories", async (orig) => ({ ...(await orig()), setCell: access.setCell }));

import { setRoleCell } from "@/modules/admin/roles/services";
import { ForbiddenError } from "@/kernel/access";

beforeEach(() => {
  vi.clearAllMocks();
  access.requirePermission.mockResolvedValue(undefined);
  h.db.user.findUnique.mockResolvedValue({ systemRole: "OWNER", status: "ACTIVE", mustChangePassword: false });
  h.db.accessRole.findUnique.mockResolvedValue({ key: "regular-developer" });
  h.db.permission.findUnique.mockResolvedValue({ resource: "leave.approval", action: "view" });
});

describe("setRoleCell 가드", () => {
  it("비-OWNER는 거부(D7 방어선)", async () => {
    h.db.user.findUnique.mockResolvedValue({ systemRole: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    await expect(setRoleCell("u1", "r1", "p1", { effect: "ALLOW", scope: "team" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("pm 행은 read-only", async () => {
    h.db.accessRole.findUnique.mockResolvedValue({ key: "pm" });
    await expect(setRoleCell("owner", "rpm", "p1", { effect: "ALLOW", scope: "all" })).rejects.toThrow(/pm/);
  });
  it("leave.approval team ALLOW 허용", async () => {
    await setRoleCell("owner", "r1", "p1", { effect: "ALLOW", scope: "team" });
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "ALLOW", "team", "owner");
  });
  it("비-scopeable resource의 team scope 거부(F5/PD2)", async () => {
    h.db.permission.findUnique.mockResolvedValue({ resource: "calendar.work", action: "view" });
    await expect(setRoleCell("owner", "r1", "p1", { effect: "ALLOW", scope: "team" })).rejects.toThrow(/지원하지 않/);
  });
  it("admin.roles:configure는 부여 불가(anti-escalation)", async () => {
    h.db.permission.findUnique.mockResolvedValue({ resource: "admin.roles", action: "configure" });
    await expect(setRoleCell("owner", "r1", "p1", { effect: "ALLOW", scope: "all" })).rejects.toThrow(/OWNER 전용/);
  });
  it("DENY는 scope를 all로 정규화", async () => {
    await setRoleCell("owner", "r1", "p1", { effect: "DENY", scope: "team" });
    expect(access.setCell).toHaveBeenCalledWith("r1", "p1", "DENY", "all", "owner");
  });
});
