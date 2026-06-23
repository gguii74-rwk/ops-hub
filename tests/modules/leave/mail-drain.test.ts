import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  leaveRequest: { findUnique: vi.fn() },
  team: { findUnique: vi.fn() },
} }));
vi.mock("@/kernel/access", () => ({ getEffectiveScope: vi.fn() }));
vi.mock("@/modules/leave/repositories/mail", () => ({
  listDueDeliveryIds: vi.fn(), claimDelivery: vi.fn(), finalizeDelivery: vi.fn(), deadLetterStaleSending: vi.fn(),
}));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));

import { drainLeaveMailOutbox, getLeaveAdminRecipients } from "@/modules/leave/services/mail";
import * as repo from "@/modules/leave/repositories/mail";
import { sendMail } from "@/lib/integrations/mail";
import { getEffectiveScope } from "@/kernel/access";
import { prisma } from "@/lib/prisma";

const r = { list: vi.mocked(repo.listDueDeliveryIds), claim: vi.mocked(repo.claimDelivery), fin: vi.mocked(repo.finalizeDelivery), dead: vi.mocked(repo.deadLetterStaleSending) };
const send = vi.mocked(sendMail);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "APPROVED", userId: "u1" } as never); // 기본: 삭제 안 됨·APPROVED(APPROVED 이벤트와 일치 → 발송 진행)
  r.dead.mockResolvedValue(0);
});

describe("drainLeaveMailOutbox", () => {
  it("claim→발송→SENT finalize 성공 시 sent++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "SENT", providerMessageId: "pm" });
  });
  it("claim 실패(선점)면 skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue(null);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });
  it("SMTP 실패면 FAILED finalize + failed++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockRejectedValue(new Error("smtp down"));
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "FAILED", errorMessage: "smtp down" });
  });
  it("발송 성공했지만 finalize 0행(그 사이 CANCELLED)이면 skipped++(SENT로 안 침)", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(false);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });
  it("발송 직전 요청이 soft-delete돼 있으면 미발송 + CANCELLED finalize + skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: new Date(), userId: "u1" } as never);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
  it("발송 직전 status가 이벤트와 어긋나면(취소된 신청의 APPROVED 통지) 미발송 + CANCELLED + skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "CANCELLED", userId: "u1" } as never); // 일반 취소: deletedAt=null이지만 status는 CANCELLED
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
  it("발송 직전 요청이 없으면(고아 outbox, findUnique null) 미발송 + CANCELLED finalize + skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(null as never);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
  it("drain 시작 시 stale SENDING dead-letter 스윕 호출", async () => {
    r.list.mockResolvedValue([]);
    await drainLeaveMailOutbox("w1");
    expect(r.dead).toHaveBeenCalled();
  });
  it("REQUESTED는 발송 직전 getLeaveAdminRecipients로 수신자 재확정(enqueue 스냅샷 무시) — 결정 A", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["stale@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "PENDING", userId: "u1" } as never); // REQUESTED ↔ PENDING 일치
    // 신청자 teamId 조회
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: "t1" } as never);
    // team 활성 조회
    vi.mocked(prisma.team.findUnique).mockResolvedValue({ active: true } as never);
    // candidates 조회
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", email: "now@x.com", teamId: "t1" }] as never);
    vi.mocked(getEffectiveScope).mockResolvedValue("all" as never);
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["now@x.com"] })); // 스냅샷 stale@x.com 아님 — 현재 권한자
  });
  it("REQUESTED인데 발송 시점 승인권한자 0명(전원 회수)이면 미발송 + FAILED", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["stale@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "PENDING", userId: "u1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ teamId: null } as never);
    vi.mocked(prisma.team.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", email: "x@x.com", teamId: null }] as never);
    vi.mocked(getEffectiveScope).mockResolvedValue(null as never); // 재확정 결과 [] → stale 스냅샷으로 발송하지 않음
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "FAILED", errorMessage: "수신자 없음" });
  });
});

describe("getLeaveAdminRecipients", () => {
  it("all-scope 사용자는 무조건 포함, team-scope는 같은 팀+팀활성일 때만 포함", async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValue({ active: true } as never); // applicantTeamId 활성 확인
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr", email: "mgr@x.com", teamId: "t2" },
      { id: "mem", email: "mem@x.com", teamId: "t1" },
    ] as never);
    vi.mocked(getEffectiveScope).mockImplementation((async (id: string) => {
      if (id === "mgr") return "all"; // 전체 scope → 포함
      if (id === "mem") return "team"; // team-scope → 같은 팀(t1)이면 포함
      return null;
    }) as never);
    const result = await getLeaveAdminRecipients("t1");
    expect(result).toContain("mgr@x.com"); // all-scope 포함
    expect(result).toContain("mem@x.com"); // team-scope + 같은팀 포함
  });

  it("F-II: 팀장이라도 leave.approval:view 미보유면 수신자 제외(매트릭스 밖 간접 부여 차단)", async () => {
    vi.mocked(prisma.team.findUnique).mockResolvedValue({ active: true } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "lead", email: "lead@x.com", teamId: "t1" }, // 그 팀 active 소속원=팀장 후보지만 approval 권한 없음
      { id: "appr", email: "appr@x.com", teamId: "t1" }, // approval:view team-scope 보유
    ] as never);
    vi.mocked(getEffectiveScope).mockImplementation((async (id: string) => (id === "appr" ? "team" : null)) as never);
    const result = await getLeaveAdminRecipients("t1");
    expect(result).toContain("appr@x.com");
    expect(result).not.toContain("lead@x.com"); // 팀장이어도 approval:view 없으면 알림 제외
  });

  it("applicantTeamId=null이면 team-scope 사용자는 제외, all-scope만 포함", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr", email: "mgr@x.com", teamId: null },
      { id: "mem", email: "mem@x.com", teamId: "t1" },
    ] as never);
    vi.mocked(getEffectiveScope).mockImplementation((async (id: string) => {
      if (id === "mgr") return "all";
      return "team";
    }) as never);
    const result = await getLeaveAdminRecipients(null);
    expect(result).toContain("mgr@x.com");
    expect(result).not.toContain("mem@x.com");
  });
});
