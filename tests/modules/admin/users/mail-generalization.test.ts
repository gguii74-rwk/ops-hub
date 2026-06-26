import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn() }, leaveRequest: { findUnique: vi.fn() } } }));
vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn() }));
vi.mock("@/modules/leave/repositories/mail", () => ({
  listDueDeliveryIds: vi.fn(), claimDelivery: vi.fn(), finalizeDelivery: vi.fn(), deadLetterStaleSending: vi.fn(),
}));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));
vi.mock("@/kernel/settings/reader", () => ({
  getSmtpConfig: vi.fn(async () => ({ host: "mail.x", port: 587, secure: false, user: "", from: "noreply@x.com" })),
}));

import { drainLeaveMailOutbox } from "@/modules/leave/services/mail";
import * as repo from "@/modules/leave/repositories/mail";
import { sendMail } from "@/lib/integrations/mail";
import { prisma } from "@/lib/prisma";

const r = { list: vi.mocked(repo.listDueDeliveryIds), claim: vi.mocked(repo.claimDelivery), fin: vi.mocked(repo.finalizeDelivery), dead: vi.mocked(repo.deadLetterStaleSending) };
const send = vi.mocked(sendMail);

beforeEach(() => {
  vi.clearAllMocks();
  r.dead.mockResolvedValue(0);
});

describe("drain 일반화 — 사용자 메일(leaveRequestId=null)", () => {
  it("leaveRequestId가 null이면 LeaveRequest 재확인 없이 바로 발송", async () => {
    r.list.mockResolvedValue(["m1"]);
    // 일반화된 claim 결과: leaveRequestId null 허용
    r.claim.mockResolvedValue({ id: "m1", leaveRequestId: null, eventType: "APPROVED", recipients: ["self@x.com"], subject: "s", bodyHtml: "b" } as never);
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    // 사용자 메일은 leaveRequest를 조회하지 않는다
    expect(vi.mocked(prisma.leaveRequest.findUnique)).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["self@x.com"] }), expect.anything());
    expect(r.fin).toHaveBeenCalledWith("m1", "w1", { status: "SENT", providerMessageId: "pm" });
  });
});

describe("drain 보존 — leave 메일(leaveRequestId 있음)은 기존대로 재확인", () => {
  it("leaveRequestId가 있으면 발송 전 LeaveRequest status 재확인 수행", async () => {
    r.list.mockResolvedValue(["m2"]);
    r.claim.mockResolvedValue({ id: "m2", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["x@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "APPROVED" } as never);
    send.mockResolvedValue({ providerMessageId: "pm" });
    r.fin.mockResolvedValue(true);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(vi.mocked(prisma.leaveRequest.findUnique)).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1" } }));
  });
  it("leaveRequestId 있고 status 불일치면 미발송 CANCELLED(기존 동작 보존)", async () => {
    r.list.mockResolvedValue(["m3"]);
    r.claim.mockResolvedValue({ id: "m3", leaveRequestId: "r1", eventType: "APPROVED", recipients: ["x@x.com"], subject: "s", bodyHtml: "b" });
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue({ deletedAt: null, status: "CANCELLED" } as never);
    expect(await drainLeaveMailOutbox("w1")).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(r.fin).toHaveBeenCalledWith("m3", "w1", expect.objectContaining({ status: "CANCELLED" }));
  });
});
