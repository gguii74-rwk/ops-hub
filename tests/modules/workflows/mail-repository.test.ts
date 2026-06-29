import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const calls: Record<string, any> = {};
  const ret: any = { active: null, created: { id: "d1" }, found: null, throwP2002: false, updateManyCount: 0, taskUpdateManyCount: 1 };
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
      updateMany: async (a: any) => {
        h.calls.updateMany = a;
        return { count: h.ret.updateManyCount };
      },
      findUnique: async (a: any) => ((h.calls.findUnique = a), h.ret.found),
      findUniqueOrThrow: async (a: any) => ((h.calls.findUniqueOrThrow = a), h.ret.found),
    },
    workflowTask: {
      updateMany: async (a: any) => {
        h.calls.taskUpdateMany = a;
        return { count: h.ret.taskUpdateManyCount };
      },
    },
    workflowTaskEvent: {
      create: async (a: any) => ((h.calls.taskEventCreate = a), { id: "ev1", ...a.data }),
    },
    $transaction: async (fn: any) => fn(client),
  };
  return { prisma: client };
});

import { claimFailedForRetry, createSendingDelivery, finalizeDelivery, finalizeDeliveryWithTransition, findDeliveryForAction } from "@/modules/workflows/repositories/mail";
import { ConflictError } from "@/modules/workflows/types";

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.ret.active = null;
  h.ret.found = null;
  h.ret.throwP2002 = false;
  h.ret.updateManyCount = 0;
  h.ret.taskUpdateManyCount = 1;
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

  it("taskId와 step이 모두 null이면(task 무관 일반 발송) 멱등 가드 미적용", async () => {
    h.ret.active = { id: "existing" }; // 있더라도 무시돼야 함
    await createSendingDelivery({ taskId: null, step: null, recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" });
    expect(h.calls.findFirst).toBeUndefined();
    expect(h.calls.create).toBeDefined();
  });

  it("task-scoped(taskId 지정)인데 step이 null이면 거부 — 멱등 키 누락(중복 발송 방지)", async () => {
    await expect(
      createSendingDelivery({ taskId: "t1", step: null, recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" }),
    ).rejects.toThrow(/step/);
    expect(h.calls.create).toBeUndefined();
  });

  it("부분 unique 인덱스 경합(P2002) → ConflictError로 정규화", async () => {
    h.ret.throwP2002 = true;
    await expect(createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("finalizeDelivery (SENDING 대상 compare-and-set)", () => {
  it("SENDING 1건만 SENT·providerMessageId로 확정하고 레코드 반환", async () => {
    h.ret.updateManyCount = 1;
    h.ret.found = { id: "d1", status: "SENT", providerMessageId: "pm1" };
    const out = await finalizeDelivery("d1", { status: "SENT", sentAt: new Date("2026-06-12"), providerMessageId: "pm1" });
    expect(h.calls.updateMany).toMatchObject({ where: { id: "d1", status: "SENDING" }, data: { status: "SENT", providerMessageId: "pm1" } });
    expect(out).toMatchObject({ id: "d1", status: "SENT" });
  });

  it("providerMessageId 미지정 시 해당 컬럼을 건드리지 않는다(resolve용)", async () => {
    h.ret.updateManyCount = 1;
    h.ret.found = { id: "d1", status: "FAILED" };
    await finalizeDelivery("d1", { status: "FAILED", sentAt: null, errorMessage: "x" });
    expect("providerMessageId" in h.calls.updateMany.data).toBe(false);
    expect(h.calls.updateMany.data).toMatchObject({ status: "FAILED", errorMessage: "x" });
  });

  it("대상이 이미 SENDING이 아니면(count 0) ConflictError — 동시 resolve/retry 경합에서 진 쪽", async () => {
    h.ret.updateManyCount = 0;
    await expect(
      finalizeDelivery("d1", { status: "SENT", sentAt: new Date(), providerMessageId: "pm1" }),
    ).rejects.toBeInstanceOf(ConflictError);
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

describe("finalizeDeliveryWithTransition (G2b 한 tx)", () => {
  const transition = { taskId: "t1", fromStatus: "GENERATED" as const, toStatus: "SENT" as const, actorId: "u1" };

  it("SUCCESS: delivery SENDING→SENT + task CAS → resolves, event 기록", async () => {
    h.ret.updateManyCount = 1;    // mailDelivery.updateMany count
    h.ret.taskUpdateManyCount = 1; // workflowTask.updateMany count
    h.ret.found = { id: "d1", status: "SENT", providerMessageId: "pm1" };

    const out = await finalizeDeliveryWithTransition("d1", { providerMessageId: "pm1" }, transition);

    // delivery finalize: SENDING→SENT
    expect(h.calls.updateMany).toMatchObject({
      where: { id: "d1", status: "SENDING" },
      data: expect.objectContaining({ status: "SENT", providerMessageId: "pm1" }),
    });
    // task CAS: fromStatus→toStatus
    expect(h.calls.taskUpdateMany).toMatchObject({
      where: { id: "t1", status: "GENERATED" },
      data: expect.objectContaining({ status: "SENT" }),
    });
    // event 기록
    expect(h.calls.taskEventCreate).toMatchObject({
      data: expect.objectContaining({ taskId: "t1", fromStatus: "GENERATED", toStatus: "SENT", actorId: "u1" }),
    });
    expect(out).toMatchObject({ id: "d1", status: "SENT" });
  });

  // G2b 핵심: cancel이 먼저 task 상태를 바꾼 경우(count 0) → ConflictError. delivery SENT도 커밋 안 됨($transaction 롤백).
  it("CONFLICT(cancel 침투): task CAS count 0 → ConflictError", async () => {
    h.ret.updateManyCount = 1;     // delivery finalize 성공
    h.ret.taskUpdateManyCount = 0; // task CAS 실패(취소가 먼저)

    await expect(
      finalizeDeliveryWithTransition("d1", { providerMessageId: "pm1" }, transition),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("CONFLICT: delivery finalize count !== 1 → ConflictError(이미 다른 경로에서 확정)", async () => {
    h.ret.updateManyCount = 0;     // delivery 이미 확정됨
    h.ret.taskUpdateManyCount = 1;

    await expect(
      finalizeDeliveryWithTransition("d1", { providerMessageId: "pm1" }, transition),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
