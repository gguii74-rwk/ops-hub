import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("@/modules/workflows/repositories/mail", () => ({
  createSendingDelivery: vi.fn(),
  finalizeDelivery: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
  findDeliveryForAction: vi.fn(),
  claimFailedForRetry: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import { sendMail } from "@/lib/integrations/mail";
import { existsSync } from "node:fs";
import * as mailRepo from "@/modules/workflows/repositories/mail";
import { deliver, retryDelivery, resolveDelivery } from "@/modules/workflows/services/mail";

const repo = mailRepo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const send = sendMail as unknown as ReturnType<typeof vi.fn>;
const fsExists = existsSync as unknown as ReturnType<typeof vi.fn>;
const ctx = (over: Partial<{ isOwner: boolean; isAdmin: boolean; keys: string[] }> = {}) => ({
  userId: "u1", isOwner: over.isOwner ?? false, isAdmin: over.isAdmin ?? false, permissionKeys: new Set(over.keys ?? []),
});

beforeEach(() => {
  repo.createSendingDelivery.mockReset().mockResolvedValue({ id: "d1" });
  repo.finalizeDelivery.mockReset().mockImplementation(async (id: string, patch: any) => ({ id, ...patch }));
  repo.findDeliveryForAction.mockReset();
  repo.claimFailedForRetry.mockReset().mockResolvedValue(true);
  send.mockReset().mockResolvedValue({ providerMessageId: "pm1" });
  fsExists.mockReset().mockReturnValue(true);
});

describe("deliver", () => {
  it("SENDING 선기록 → SMTP 성공 → SENT 갱신", async () => {
    const out = await deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "<p>h</p>" }, sentById: "u1" });
    expect(repo.createSendingDelivery).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", step: "send", bodyHtml: "<p>h</p>" }));
    expect(send).toHaveBeenCalled();
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT", providerMessageId: "pm1" }));
    expect((out as any).status).toBe("SENT");
  });

  it("SMTP 실패 → FAILED 갱신(에러 비전파, 전이 롤백 없음)", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    const out = await deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "h" }, sentById: "u1" });
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED", sentAt: null, errorMessage: "smtp down" }));
    expect((out as any).status).toBe("FAILED");
  });

  it("멱등 충돌(createSendingDelivery ConflictError) → 전파, SMTP 미발생", async () => {
    repo.createSendingDelivery.mockRejectedValue(new ConflictError());
    await expect(deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "h" }, sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("retryDelivery", () => {
  const failed = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], subject: "s", bodyHtml: "<p>저장본문</p>", attachmentPaths: ["/o/a.pdf"], kind: "WEEKLY_REPORT" };

  it("FAILED를 저장된 bodyHtml로 재발송(워크플로 재생성 없음) → SENT", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x"], subject: "s", html: "<p>저장본문</p>" }));
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
  });

  it("SMTP 전에 FAILED→SENDING 원자 점유(claimFailedForRetry)로 단일 비행", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(repo.claimFailedForRetry).toHaveBeenCalledWith("d1", "t1");
    expect(repo.claimFailedForRetry.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it("점유 실패(경합에서 짐) → Conflict, SMTP 미발생·중복 발송 차단", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    repo.claimFailedForRetry.mockResolvedValue(false);
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ConflictError);
    expect(send).not.toHaveBeenCalled();
  });

  it("없음 → Forbidden", async () => {
    repo.findDeliveryForAction.mockResolvedValue(null);
    await expect(retryDelivery({ deliveryId: "x", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("taskId 불일치 → Forbidden", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, taskId: "other" });
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("SENDING(발송 불확실)은 재시도 불가 → Conflict", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, status: "SENDING" });
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("타 kind :send로는 거부 → Forbidden", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed); // kind=WEEKLY_REPORT
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("첨부 유실 → SMTP 없이 FAILED 확정", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    fsExists.mockReturnValue(false);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).not.toHaveBeenCalled();
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });
});

describe("resolveDelivery", () => {
  const sending = { id: "d1", taskId: "t1", step: "send", status: "SENDING", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], kind: "WEEKLY_REPORT" };

  it("비-admin → Forbidden", async () => {
    await expect(resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: false }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admin이 SENDING→FAILED 확정", async () => {
    repo.findDeliveryForAction.mockResolvedValue(sending);
    await resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: true }));
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });

  it("admin이 SENDING→SENT 확정", async () => {
    repo.findDeliveryForAction.mockResolvedValue(sending);
    await resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "SENT" }, ctx({ isAdmin: true }));
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
  });

  it("SENDING이 아니면 Conflict", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...sending, status: "SENT" });
    await expect(resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: true }))).rejects.toBeInstanceOf(ConflictError);
  });
});
