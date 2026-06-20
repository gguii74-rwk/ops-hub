import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() }, leaveRequest: { findUnique: vi.fn() } } }));
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn() }));
vi.mock("@/modules/leave/repositories/mail", () => ({
  listDueDeliveryIds: vi.fn(), claimDelivery: vi.fn(), finalizeDelivery: vi.fn(), deadLetterStaleSending: vi.fn(),
}));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));

import { drainLeaveMailOutbox, getLeaveAdminRecipients } from "@/modules/leave/services/mail";
import * as repo from "@/modules/leave/repositories/mail";
import { sendMail } from "@/lib/integrations/mail";
import { hasPermission } from "@/kernel/access";
import { prisma } from "@/lib/prisma";

const r = { list: vi.mocked(repo.listDueDeliveryIds), claim: vi.mocked(repo.claimDelivery), fin: vi.mocked(repo.finalizeDelivery), dead: vi.mocked(repo.deadLetterStaleSending) };
const send = vi.mocked(sendMail);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "APPROVED" } as never); // 기본: 삭제 안 됨·APPROVED(APPROVED 이벤트와 일치 → 발송 진행)
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
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: new Date() } as never);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
  it("발송 직전 status가 이벤트와 어긋나면(취소된 신청의 APPROVED 통지) 미발송 + CANCELLED + skipped++", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["a@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "CANCELLED" } as never); // 일반 취소: deletedAt=null이지만 status는 CANCELLED
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
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "PENDING" } as never); // REQUESTED ↔ PENDING 일치
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", email: "now@x.com" }] as never);
    vi.mocked(hasPermission).mockResolvedValue(true as never);
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["now@x.com"] })); // 스냅샷 stale@x.com 아님 — 현재 권한자
  });
  it("REQUESTED인데 발송 시점 승인권한자 0명(전원 회수)이면 미발송 + FAILED", async () => {
    r.list.mockResolvedValue(["m1"]);
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["stale@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "PENDING" } as never); // REQUESTED ↔ PENDING 일치(수신자 갭만 테스트)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", email: "x@x.com" }] as never);
    vi.mocked(hasPermission).mockResolvedValue(false as never); // 재확정 결과 [] → stale 스냅샷으로 발송하지 않음
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "FAILED", errorMessage: "수신자 없음" });
  });
});

describe("getLeaveAdminRecipients", () => {
  it("전 active 사용자 중 leave.approval:view 보유자만(MEMBER라도 권한 있으면 포함, MANAGER라도 없으면 제외)", async () => {
    // mgr=권한없는 MANAGER(제외), mem=role/override로 권한 받은 MEMBER(포함)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr", email: "mgr@x.com" }, { id: "mem", email: "mem@x.com" },
    ] as never);
    vi.mocked(hasPermission).mockImplementation((async (id: string) => id === "mem") as never);
    expect(await getLeaveAdminRecipients()).toEqual(["mem@x.com"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "ACTIVE" }, // systemRole prefilter 없음(role/override 부여자 누락 방지)
      select: { id: true, email: true },
    }));
    expect(hasPermission).toHaveBeenCalledWith("mgr", "leave.approval", "view");
  });
});
