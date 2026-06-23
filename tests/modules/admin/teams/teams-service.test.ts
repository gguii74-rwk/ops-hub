import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    team: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),               // 후보 user 행 FOR UPDATE 잠금(F-E)
  };
  return { tx, db: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));

import { updateTeam } from "@/modules/admin/teams/repositories";
// 에러 클래스는 실제(prisma 비의존) — mock 불필요.

const NOW = new Date("2026-06-23T00:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  h.tx.team.findUnique.mockResolvedValue({ name: "A", active: true, leadUserId: null, updatedAt: NOW });
  h.tx.team.updateMany.mockResolvedValue({ count: 1 });
  h.tx.auditLog.create.mockResolvedValue({});
  h.tx.$queryRaw.mockResolvedValue([]); // FOR UPDATE 잠금(반환값 미사용)
});

describe("팀장 불변식(F3·F-E)", () => {
  it("타 팀 사용자를 lead로 지정하면 거부", async () => {
    h.tx.user.findUnique.mockResolvedValue({ teamId: "teamB", status: "ACTIVE" });
    await expect(updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner")).rejects.toThrow(/팀장은/);
    expect(h.tx.team.updateMany).not.toHaveBeenCalled();
  });
  it("F-E: 후보 검증 전에 후보 user 행을 FOR UPDATE 잠근다(동시 멤버 이동 직렬화)", async () => {
    const calls: string[] = [];
    h.tx.$queryRaw.mockImplementation((q: { raw?: string[] } | TemplateStringsArray) => {
      calls.push("lock"); // $queryRaw 태그드 호출 — FOR UPDATE
      return Promise.resolve([]);
    });
    h.tx.user.findUnique.mockImplementation(() => { calls.push("read"); return Promise.resolve({ teamId: "teamA", status: "ACTIVE" }); });
    await updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner");
    expect(calls).toEqual(["lock", "read"]); // 잠금이 검증 read보다 먼저
  });
  it("비active 사용자를 lead로 지정하면 거부", async () => {
    h.tx.user.findUnique.mockResolvedValue({ teamId: "teamA", status: "DISABLED" });
    await expect(updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner")).rejects.toThrow(/팀장은/);
  });
  it("같은 팀 active 소속원은 lead 지정 허용", async () => {
    h.tx.user.findUnique.mockResolvedValue({ teamId: "teamA", status: "ACTIVE" });
    await updateTeam("teamA", { leadUserId: "u1" }, NOW, "owner");
    expect(h.tx.team.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leadUserId: "u1" }) }));
  });
  it("active=false로 바꾸면 lead 자동 해제", async () => {
    h.tx.user.findUnique.mockResolvedValue(null);
    await updateTeam("teamA", { active: false }, NOW, "owner");
    expect(h.tx.team.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ active: false, leadUserId: null }) }));
  });
});
