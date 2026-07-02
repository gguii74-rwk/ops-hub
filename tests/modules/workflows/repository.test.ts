import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: Record<string, any> = {};
  const ret: any = { findMany: [], findUnique: null, updateCount: 1, typeKind: null, count: 0 };
  const events: any[] = [];
  return { calls, ret, events };
});

vi.mock("@/lib/prisma", () => {
  const client: any = {
    workflowTask: {
      findMany: async (a: any) => ((h.calls.list = a), h.ret.findMany),
      findUnique: async (a: any) => ((h.calls.findUnique = a), h.ret.findUnique),
      updateMany: async (a: any) => ((h.calls.updateMany = a), { count: h.ret.updateCount }),
      create: async (a: any) => ((h.calls.taskCreate = a), { id: "new-task" }),
    },
    workflowType: { findUnique: async (a: any) => ((h.calls.typeFind = a), h.ret.typeKind ? { kind: h.ret.typeKind } : null) },
    workflowTaskEvent: { create: async (a: any) => (h.events.push(a.data), a.data) },
    generatedFile: { createMany: async (a: any) => ((h.calls.fileCreate = a), { count: a.data.length }) },
    mailDelivery: { count: async (a: any) => ((h.calls.mailCount = a), h.ret.count) },
    $transaction: async (fn: any) => fn(client),
  };
  return { prisma: client };
});

import {
  findTaskList,
  findTaskDetail,
  findTaskForTransition,
  findWorkflowTypeKind,
  createTaskWithInitialEvent,
  applyTransitionAtomic,
  createGeneratedFiles,
  hasActiveSending,
} from "@/modules/workflows/repositories";

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.ret.findMany = [];
  h.ret.findUnique = null;
  h.ret.updateCount = 1;
  h.ret.typeKind = null;
  h.ret.count = 0;
  h.events.length = 0;
});

describe("findTaskList", () => {
  it("kinds가 비면 prisma 호출 없이 []", async () => {
    const out = await findTaskList({ kinds: [] });
    expect(out).toEqual([]);
    expect(h.calls.list).toBeUndefined();
  });

  it("type.kind in + status·범위 필터로 조회하고 매핑", async () => {
    h.ret.findMany = [{ id: "t1", scheduledAt: new Date("2026-06-12"), status: "PENDING", type: { kind: "WEEKLY_REPORT", name: "주간보고" } }];
    const out = await findTaskList({ kinds: ["WEEKLY_REPORT"], statuses: ["PENDING"], start: new Date("2026-06-01"), end: new Date("2026-07-01") });
    expect(out).toEqual([{ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: new Date("2026-06-12"), status: "PENDING" }]);
    expect(h.calls.list.where.type).toEqual({ kind: { in: ["WEEKLY_REPORT"] } });
    expect(h.calls.list.where.status).toEqual({ in: ["PENDING"] });
    expect(h.calls.list.where.scheduledAt).toEqual({ gte: new Date("2026-06-01"), lt: new Date("2026-07-01") });
  });
});

describe("findTaskDetail", () => {
  it("없으면 null", async () => {
    h.ret.findUnique = null;
    expect(await findTaskDetail("nope")).toBeNull();
  });

  it("type·files·mail·events를 평탄화해 반환", async () => {
    h.ret.findUnique = {
      id: "t1", scheduledAt: new Date("2026-06-12"), status: "GENERATED", createdById: "u1", outputPath: null,
      type: { kind: "WEEKLY_REPORT", name: "주간보고", defaultRecipients: { "1": { to: ["a@x"], cc: [], bcc: [] } } },
      files: [{ id: "f1", path: "/o/a.xlsx", displayName: "a.xlsx", mimeType: null, sizeBytes: 10n, createdAt: new Date("2026-06-12") }],
      mailDeliveries: [{ id: "m1", step: "send", recipients: ["a@x"], cc: ["c@x"], bcc: null, subject: "s", status: "SENT", errorMessage: null, providerMessageId: "pm1", sentAt: new Date("2026-06-12") }],
      events: [{ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: new Date("2026-06-12") }],
    };
    const out = await findTaskDetail("t1");
    expect(out?.kind).toBe("WEEKLY_REPORT");
    expect(out?.typeName).toBe("주간보고");
    expect(out?.files[0].id).toBe("f1");
    expect(out?.mailDeliveries[0].status).toBe("SENT");
    expect(out?.events[0].toStatus).toBe("PENDING");
    expect(out?.mailDeliveries[0].cc).toEqual(["c@x"]);
    expect(out?.mailDeliveries[0].bcc).toBeNull();
    expect(out?.defaultRecipients).toEqual({ "1": { to: ["a@x"], cc: [], bcc: [] } });
    expect("recipients" in (out as object)).toBe(false); // D5 — 死필드 select 제거
  });
});

describe("findTaskForTransition / findWorkflowTypeKind", () => {
  it("transition용 조회는 kind를 평탄화", async () => {
    h.ret.findUnique = { id: "t1", status: "PENDING", createdById: "u1", type: { kind: "BILLING" } };
    expect(await findTaskForTransition("t1")).toEqual({ id: "t1", status: "PENDING", createdById: "u1", kind: "BILLING" });
  });
  it("typeKind 조회: 있으면 kind, 없으면 null", async () => {
    h.ret.typeKind = "WEEKLY_REPORT";
    expect(await findWorkflowTypeKind("wf-weekly")).toBe("WEEKLY_REPORT");
    h.ret.typeKind = null;
    expect(await findWorkflowTypeKind("nope")).toBeNull();
  });
});

describe("createTaskWithInitialEvent", () => {
  it("task 생성 + 초기 이벤트(fromStatus=null,toStatus=PENDING)를 tx로 기록", async () => {
    const out = await createTaskWithInitialEvent({ typeId: "wf-weekly", scheduledAt: new Date("2026-06-20"), createdById: "u1" });
    expect(out).toEqual({ id: "new-task" });
    expect(h.calls.taskCreate.data).toMatchObject({ typeId: "wf-weekly", createdById: "u1", status: "PENDING" });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ taskId: "new-task", fromStatus: null, toStatus: "PENDING", actorId: "u1" });
  });
});

describe("applyTransitionAtomic", () => {
  it("1행 갱신 시 true + 이벤트 1건, stampField를 data에 반영", async () => {
    h.ret.updateCount = 1;
    const ok = await applyTransitionAtomic({ taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", note: "gen", stampField: "generatedAt" });
    expect(ok).toBe(true);
    expect(h.calls.updateMany.where).toEqual({ id: "t1", status: "PENDING" });
    expect(h.calls.updateMany.data.status).toBe("GENERATED");
    expect(h.calls.updateMany.data.generatedAt).toBeInstanceOf(Date);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", note: "gen" });
  });

  it("0행 갱신(경합) 시 false + 이벤트 없음", async () => {
    h.ret.updateCount = 0;
    const ok = await applyTransitionAtomic({ taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", stampField: "generatedAt" });
    expect(ok).toBe(false);
    expect(h.events).toHaveLength(0);
  });

  it("stampField=null이면 타임스탬프를 넣지 않는다", async () => {
    await applyTransitionAtomic({ taskId: "t1", fromStatus: "PENDING", toStatus: "CANCELLED", actorId: "u1", stampField: null });
    expect(h.calls.updateMany.data).toEqual({ status: "CANCELLED" });
  });
});

describe("createGeneratedFiles / hasActiveSending", () => {
  it("빈 배열이면 prisma 호출 없음", async () => {
    await createGeneratedFiles("t1", []);
    expect(h.calls.fileCreate).toBeUndefined();
  });
  it("sizeBytes는 BigInt로 변환해 createMany", async () => {
    await createGeneratedFiles("t1", [{ path: "/o/a.xlsx", displayName: "a.xlsx", sizeBytes: 123 }]);
    expect(h.calls.fileCreate.data[0]).toMatchObject({ taskId: "t1", path: "/o/a.xlsx", displayName: "a.xlsx", sizeBytes: 123n, mimeType: null });
  });
  it("hasActiveSending: SENDING count>0 → true", async () => {
    h.ret.count = 2;
    expect(await hasActiveSending("t1")).toBe(true);
    expect(h.calls.mailCount.where).toEqual({ taskId: "t1", status: "SENDING" });
    h.ret.count = 0;
    expect(await hasActiveSending("t1")).toBe(false);
  });
});
