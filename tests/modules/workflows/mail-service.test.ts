import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));
vi.mock("@/kernel/settings/reader", () => ({
  getSmtpConfig: vi.fn(async () => ({ host: "mail.x", port: 587, secure: false, user: "", from: "noreply@x.com" })),
}));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("@/lib/storage", () => ({
  resolveStoragePath: vi.fn((p: string) => {
    if (p.startsWith("out/") || p.startsWith("Template/")) return `/abs/${p}`;
    throw new Error("strict: 절대경로/허용 안 된 경로");
  }),
  toStoredOutputPath: vi.fn((abs: string) => abs.replace("/abs/", "")),
}));
vi.mock("@/modules/workflows/repositories/mail", () => ({
  createSendingDelivery: vi.fn(),
  finalizeDelivery: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
  finalizeDeliveryWithTransition: vi.fn(),
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
  repo.finalizeDeliveryWithTransition.mockReset().mockResolvedValue({ id: "d1", status: "SENT" });
  repo.findDeliveryForAction.mockReset();
  repo.claimFailedForRetry.mockReset().mockResolvedValue(true);
  send.mockReset().mockResolvedValue({ providerMessageId: "pm1" });
  fsExists.mockReset().mockReturnValue(true);
});

describe("deliver", () => {
  it("SENDING 선기록 → SMTP 성공 → SENT 갱신(onDelivered 없음 경로)", async () => {
    const out = await deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "<p>h</p>" }, sentById: "u1" });
    expect(repo.createSendingDelivery).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", step: "send", bodyHtml: "<p>h</p>" }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "s" }),
      expect.objectContaining({ host: "mail.x" }),
    );
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT", providerMessageId: "pm1" }));
    // G2b 전이 경로는 사용하지 않아야 한다.
    expect(repo.finalizeDeliveryWithTransition).not.toHaveBeenCalled();
    expect((out as any).status).toBe("SENT");
  });

  // G2b: onDelivered + taskId 지정 시 SMTP 성공 → finalizeDeliveryWithTransition 호출,
  // plain finalizeDelivery(SENT) 는 호출 금지.
  it("SMTP 성공 + onDelivered 지정 → finalizeDeliveryWithTransition 호출, finalizeDelivery(SENT) 미호출", async () => {
    const out = await deliver({
      taskId: "t1",
      step: "send",
      msg: { to: ["a@x"], subject: "s", html: "<p>h</p>" },
      sentById: "u1",
      onDelivered: { fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" },
    });
    expect(repo.finalizeDeliveryWithTransition).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ providerMessageId: "pm1" }),
      expect.objectContaining({ taskId: "t1", fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" }),
    );
    // plain SENT finalizer는 이 경로에서 사용하지 않는다.
    expect(repo.finalizeDelivery).not.toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
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

  // SMTP가 메일을 수락한 뒤 SENT 확정만 실패하면, FAILED로 둔갑시키지 않고(중복 발송 위험) 에러를 전파해
  // 행을 SENDING으로 남긴다(admin resolve 대상). SMTP 실패와 DB 확정 실패는 다른 사건이다.
  it("SMTP 성공 후 SENT 확정 실패 → 에러 전파(FAILED 변환 금지, SENDING 유지)", async () => {
    repo.finalizeDelivery.mockImplementation(async (id: string, patch: any) => {
      if (patch.status === "SENT") throw new Error("db down");
      return { id, ...patch };
    });
    await expect(
      deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "h" }, sentById: "u1" }),
    ).rejects.toThrow("db down");
    expect(send).toHaveBeenCalled();
    expect(repo.finalizeDelivery).not.toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });
});

describe("retryDelivery", () => {
  const failed = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], subject: "s", bodyHtml: "<p>저장본문</p>", attachmentPaths: ["out/workflows/t1/a.hwpx"], kind: "WEEKLY_REPORT" };

  it("FAILED를 저장된 bodyHtml로 재발송(워크플로 재생성 없음) → SENT", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x"], subject: "s", html: "<p>저장본문</p>" }), expect.anything());
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
  });

  it("SMTP 전에 FAILED→SENDING 원자 점유(claimFailedForRetry)로 단일 비행", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed); // kind=WEEKLY_REPORT, step="send" → 전이 매핑 없음
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(repo.claimFailedForRetry).toHaveBeenCalledWith("d1", "t1", undefined); // 전이 없음 → task-status 가드 미적용
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

  // deliver와 동일: 재발송 SMTP 수락 후 SENT 확정만 실패하면 FAILED로 되돌리지 않고 에러 전파(SENDING 유지).
  it("SMTP 성공 후 SENT 확정 실패 → 에러 전파(FAILED 변환 금지, SENDING 유지)", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    repo.finalizeDelivery.mockImplementation(async (id: string, patch: any) => {
      if (patch.status === "SENT") throw new Error("db down");
      return { id, ...patch };
    });
    await expect(
      retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] })),
    ).rejects.toThrow("db down");
    expect(send).toHaveBeenCalled();
    expect(repo.finalizeDelivery).not.toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });

  it("절대경로 첨부 row → retry 거부(I4, exfiltration 차단)", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, attachmentPaths: ["/etc/passwd"] });
    const out = await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).not.toHaveBeenCalled();
    expect((out as any).status).toBe("FAILED");
  });

  // R1-2 fix: billing step 발송은 복구도 전이 인지여야 한다. retry 성공 시 finalizeDeliveryWithTransition으로
  // SENT 확정 + 워크플로 전이(GENERATED→SENT)를 한 tx로. plain finalizeDelivery(SENT) 미사용.
  it("billing step1 retry 성공 → finalizeDeliveryWithTransition(GENERATED→SENT), plain SENT 미사용", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, kind: "BILLING", step: "1" });
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }));
    expect(repo.finalizeDeliveryWithTransition).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ providerMessageId: "pm1" }),
      expect.objectContaining({ taskId: "t1", fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" }),
    );
    expect(repo.finalizeDelivery).not.toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
  });

  it("billing step2 retry 성공 → finalizeDeliveryWithTransition(SENT→HQ_REQUESTED)", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, kind: "BILLING", step: "2" });
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }));
    expect(repo.finalizeDeliveryWithTransition).toHaveBeenCalledWith(
      "d1", expect.anything(),
      expect.objectContaining({ fromStatus: "SENT", toStatus: "HQ_REQUESTED" }),
    );
  });

  // R4-1: billing step retry는 claim에 기대 fromStatus 가드를 넘긴다(D11/H1 retry 확장).
  it("billing step1 retry → claimFailedForRetry에 기대 fromStatus(GENERATED) 전달", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, kind: "BILLING", step: "1" });
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }));
    expect(repo.claimFailedForRetry).toHaveBeenCalledWith("d1", "t1", "GENERATED");
  });

  // R4-1 핵심: 취소·단계 어긋남으로 claim이 거부되면(false) → ConflictError, SMTP 미발생.
  it("취소된 작업(claim false) retry → Conflict, SMTP 미발생", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, kind: "BILLING", step: "1" });
    repo.claimFailedForRetry.mockResolvedValue(false); // task가 GENERATED가 아님(예: CANCELLED) → 점유 거부
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }))).rejects.toBeInstanceOf(ConflictError);
    expect(send).not.toHaveBeenCalled();
  });

  it("전이 매핑 없는 step(kind=WEEKLY) retry 성공 → 현행 plain finalizeDelivery(SENT) 유지", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed); // kind=WEEKLY_REPORT, step="send"
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(repo.finalizeDeliveryWithTransition).not.toHaveBeenCalled();
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
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

  // R1-2 fix: billing step의 SENDING→SENT 수동 확정은 워크플로 전이도 적용(메일은 이미 나갔으나 전이 tx가 실패해 남은 잔여).
  it("billing step1 SENDING→SENT resolve → finalizeDeliveryWithTransition(GENERATED→SENT)", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...sending, kind: "BILLING", step: "1" });
    await resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "SENT" }, ctx({ isAdmin: true }));
    expect(repo.finalizeDeliveryWithTransition).toHaveBeenCalledWith(
      "d1", expect.objectContaining({ providerMessageId: null }),
      expect.objectContaining({ taskId: "t1", fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" }),
    );
  });

  it("billing step1 SENDING→FAILED resolve → 전이 없음(plain finalizeDelivery)", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...sending, kind: "BILLING", step: "1" });
    await resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: true }));
    expect(repo.finalizeDeliveryWithTransition).not.toHaveBeenCalled();
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });
});
