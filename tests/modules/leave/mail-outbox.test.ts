import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const db = {
    mailDelivery: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  };
  return { db, prisma: db };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import {
  insertPendingDelivery, cancelPendingDeliveries, listDueDeliveryIds, claimDelivery, finalizeDelivery,
  deadLetterStaleSending, MAIL_MAX_ATTEMPTS, MAIL_RETRY_BACKOFF_MS,
} from "@/modules/leave/repositories/mail";

beforeEach(() => vi.clearAllMocks());

describe("insertPendingDelivery", () => {
  it("PENDING 행을 tx로 생성", async () => {
    h.db.mailDelivery.create.mockResolvedValue({ id: "m1" });
    await insertPendingDelivery(h.db as never, { leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>" });
    expect(h.db.mailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaveRequestId: "r1", eventType: "REQUESTED", status: "PENDING", attempts: 0 }),
    }));
  });
  it("@@unique 충돌(P2002)은 조용히 무시", async () => {
    h.db.mailDelivery.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(insertPendingDelivery(h.db as never, { leaveRequestId: "r1", eventType: "REQUESTED", recipients: [], subject: "s", bodyHtml: "" })).resolves.toBeUndefined();
  });
});

describe("cancelPendingDeliveries", () => {
  it("PENDING/FAILED/stale SENDING(lease 만료)만 CANCELLED — active SENDING은 건드리지 않음(정직 finalize 보존)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date("2026-07-01T00:00:00Z");
    await cancelPendingDeliveries(h.db as never, "r1", now);
    const arg = h.db.mailDelivery.updateMany.mock.calls[0][0];
    expect(arg.where.leaveRequestId).toBe("r1");
    expect(arg.where.OR).toEqual([
      { status: "PENDING" }, { status: "FAILED" }, { status: "SENDING", lockedUntil: { lt: now } },
    ]);
    expect(arg.data).toMatchObject({ status: "CANCELLED", lockedUntil: null });
  });
});

describe("claimDelivery", () => {
  it("count 1이면 SENDING+lease+attempts++ 후 데이터(leaveRequestId 포함) 반환", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    h.db.mailDelivery.findUnique.mockResolvedValue({ id: "m1", leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>", workerId: "w1", status: "SENDING" });
    const out = await claimDelivery("m1", "w1", new Date());
    expect(out).toEqual({ id: "m1", leaveRequestId: "r1", eventType: "REQUESTED", recipients: ["a@x.com"], subject: "s", bodyHtml: "<p>b</p>" });
    expect(h.db.mailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENDING", workerId: "w1", attempts: { increment: 1 } }),
    }));
  });
  it("count 0(선점)이면 null", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimDelivery("m1", "w1", new Date())).toBeNull();
  });
});

describe("deadLetterStaleSending", () => {
  it("stale SENDING(lease 만료)·attempts>=N을 FAILED로 종결(발송 안 함)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-01T00:00:00Z");
    expect(await deadLetterStaleSending(now)).toBe(1);
    const arg = h.db.mailDelivery.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: "SENDING", lockedUntil: { lt: now }, attempts: { gte: MAIL_MAX_ATTEMPTS } });
    expect(arg.data).toMatchObject({ status: "FAILED", lockedUntil: null });
  });
});

describe("finalizeDelivery", () => {
  it("status=SENDING AND workerId=self일 때만(true)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    expect(await finalizeDelivery("m1", "w1", { status: "SENT", providerMessageId: "pm" })).toBe(true);
    expect(h.db.mailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "m1", status: "SENDING", workerId: "w1" },
    }));
  });
  it("0행이면 false(CANCELLED/선점 — 덮어쓰지 않음)", async () => {
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 0 });
    expect(await finalizeDelivery("m1", "w1", { status: "SENT" })).toBe(false);
  });
  it("FAILED는 lockedUntil을 backoff(미래)로 설정 — 즉시 재claim 방지", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-01T00:00:00Z");
    vi.setSystemTime(now);
    h.db.mailDelivery.updateMany.mockResolvedValue({ count: 1 });
    await finalizeDelivery("m1", "w1", { status: "FAILED", errorMessage: "smtp down" });
    const arg = h.db.mailDelivery.updateMany.mock.calls[0][0];
    expect(arg.data.status).toBe("FAILED");
    expect(arg.data.lockedUntil).toEqual(new Date(now.getTime() + MAIL_RETRY_BACKOFF_MS));
    vi.useRealTimers();
  });
});

describe("listDueDeliveryIds", () => {
  it("eventType not null 후보 조건으로 조회(leave/user 공통, workflow 행 제외)", async () => {
    h.db.mailDelivery.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    const ids = await listDueDeliveryIds(new Date(), 50);
    expect(ids).toEqual(["m1", "m2"]);
    const arg = h.db.mailDelivery.findMany.mock.calls[0][0];
    // 일반화 후: leaveRequestId 스코프 제거(사용자 메일도 후보), eventType not null만 유지(workflow 행 제외).
    expect(arg.where.leaveRequestId).toBeUndefined();
    expect(arg.where.eventType).toEqual({ not: null });
    expect(MAIL_MAX_ATTEMPTS).toBe(3);
  });
  it("FAILED 후보는 backoff(lockedUntil) 경과분만 — 즉시 재claim 안 함", async () => {
    h.db.mailDelivery.findMany.mockResolvedValue([]);
    const now = new Date("2026-07-01T00:00:00Z");
    await listDueDeliveryIds(now, 50);
    const arg = h.db.mailDelivery.findMany.mock.calls[0][0];
    const failedClause = (arg.where.OR as Array<Record<string, unknown>>).find((c) => c.status === "FAILED");
    expect(failedClause).toMatchObject({ attempts: { lt: MAIL_MAX_ATTEMPTS } });
    expect(failedClause!.OR).toEqual([{ lockedUntil: null }, { lockedUntil: { lt: now } }]);
  });
});
