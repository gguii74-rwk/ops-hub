import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const calls: Record<string, any> = {};
  const ret: any = { active: null, created: { id: "d1" }, found: null, throwP2002: false, updateManyCount: 0 };
  return { calls, ret };
});

vi.mock("@/lib/prisma", () => {
  const client: any = {
    mailDelivery: {
      findFirst: async (a: any) => ((h.calls.findFirst = a), h.ret.active),
      create: async (a: any) => {
        h.calls.create = a;
        if (h.ret.throwP2002) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        return { id: "d1", ...a.data };
      },
      update: async (a: any) => ((h.calls.update = a), { id: a.where.id, ...a.data }),
      updateMany: async (a: any) => ((h.calls.updateMany = a), { count: h.ret.updateManyCount }),
      findUnique: async (a: any) => ((h.calls.findUnique = a), h.ret.found),
    },
    $transaction: async (fn: any) => fn(client),
  };
  return { prisma: client };
});

import { claimFailedForRetry, createSendingDelivery, finalizeDelivery, findDeliveryForAction } from "@/modules/workflows/repositories/mail";
import { ConflictError } from "@/modules/workflows/types";

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.ret.active = null;
  h.ret.found = null;
  h.ret.throwP2002 = false;
  h.ret.updateManyCount = 0;
});

describe("createSendingDelivery", () => {
  it("활성 발송 없으면 SENDING·sentAt=null로 생성", async () => {
    const out = await createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "<p>h</p>", attachmentPaths: [], sentById: "u1" });
    expect(out.id).toBe("d1");
    expect(h.calls.create.data).toMatchObject({ taskId: "t1", step: "send", status: "SENDING", sentAt: null, bodyHtml: "<p>h</p>" });
  });

  it("(taskId,step) 활성 레코드가 있으면 ConflictError(생성 안 함)", async () => {
    h.ret.active = { id: "existing" };
    await expect(createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("taskId 또는 step이 null이면 멱등 가드를 적용하지 않는다", async () => {
    h.ret.active = { id: "existing" }; // 있더라도 무시돼야 함
    await createSendingDelivery({ taskId: null, step: null, recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" });
    expect(h.calls.findFirst).toBeUndefined();
    expect(h.calls.create).toBeDefined();
  });

  it("부분 unique 인덱스 경합(P2002) → ConflictError로 정규화", async () => {
    h.ret.throwP2002 = true;
    await expect(createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("finalizeDelivery", () => {
  it("SENT 갱신은 sentAt·providerMessageId를 설정", async () => {
    await finalizeDelivery("d1", { status: "SENT", sentAt: new Date("2026-06-12"), providerMessageId: "pm1" });
    expect(h.calls.update.where).toEqual({ id: "d1" });
    expect(h.calls.update.data).toMatchObject({ status: "SENT", providerMessageId: "pm1" });
  });

  it("providerMessageId 미지정 시 해당 컬럼을 건드리지 않는다(resolve용)", async () => {
    await finalizeDelivery("d1", { status: "FAILED", sentAt: null, errorMessage: "x" });
    expect("providerMessageId" in h.calls.update.data).toBe(false);
    expect(h.calls.update.data).toMatchObject({ status: "FAILED", errorMessage: "x" });
  });
});

describe("claimFailedForRetry", () => {
  it("FAILED→SENDING 1건 갱신되면 true (원자 점유 성공)", async () => {
    h.ret.updateManyCount = 1;
    const ok = await claimFailedForRetry("d1", "t1");
    expect(ok).toBe(true);
    expect(h.calls.updateMany).toMatchObject({ where: { id: "d1", taskId: "t1", status: "FAILED" }, data: { status: "SENDING" } });
  });

  it("0건 갱신(이미 SENDING/다른 상태 — 경합에서 짐)이면 false", async () => {
    h.ret.updateManyCount = 0;
    expect(await claimFailedForRetry("d1", "t1")).toBe(false);
  });
});

describe("findDeliveryForAction", () => {
  it("task→type.kind를 평탄화하고 recipients/attachmentPaths를 배열로", async () => {
    h.ret.found = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], subject: "s", bodyHtml: "<p>h</p>", attachmentPaths: ["/o/a.pdf"], task: { type: { kind: "BILLING" } } };
    const out = await findDeliveryForAction("d1");
    expect(out).toMatchObject({ id: "d1", taskId: "t1", status: "FAILED", kind: "BILLING", recipients: ["a@x"], attachmentPaths: ["/o/a.pdf"] });
  });
  it("없으면 null", async () => {
    expect(await findDeliveryForAction("nope")).toBeNull();
  });
});
