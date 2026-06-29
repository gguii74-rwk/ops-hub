import { describe, it, expect, beforeEach, vi } from "vitest";

// commitGeneratedTransition의 lease 소유권 가드(R1-2): 생성 도중 lease가 steal당하면(holder 불일치/소멸)
// commit을 거부해 패배자 산출물이 DB에 기록되지 않게 한다(disk≠DB 분기 차단).
const h = vi.hoisted(() => {
  const calls: Record<string, unknown> = {};
  const ret: { lockRows: Array<{ holder: string }>; taskUpdateCount: number; existingRound: unknown } = {
    lockRows: [{ holder: "req-1" }], taskUpdateCount: 1, existingRound: null,
  };
  return { calls, ret };
});

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async (..._a: unknown[]) => h.ret.lockRows,
    workflowTask: { updateMany: async (a: unknown) => ((h.calls.taskUpdate = a), { count: h.ret.taskUpdateCount }) },
    generatedFile: { createMany: async (a: unknown) => ((h.calls.fileCreate = a), { count: 1 }) },
    workflowTaskEvent: { create: async (a: unknown) => ((h.calls.eventCreate = a), { id: "ev1" }) },
    billingRoundDate: {
      findUnique: async (a: unknown) => ((h.calls.roundFind = a), h.ret.existingRound),
      create: async (a: unknown) => ((h.calls.roundCreate = a), { id: "rd1" }),
    },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { commitGeneratedTransition } from "@/modules/workflows/repositories";
import { ConflictError } from "@/modules/workflows/types";

const baseArgs = {
  taskId: "t1", actorId: "u1", holder: "req-1", outputPath: "out/workflows/t1",
  files: [{ path: "out/workflows/t1/a.hwpx", displayName: "a.hwpx" }],
};

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.ret.lockRows = [{ holder: "req-1" }];
  h.ret.taskUpdateCount = 1;
  h.ret.existingRound = null;
});

describe("commitGeneratedTransition holder 가드 (R1-2)", () => {
  it("holder 일치 → 정상 commit(status CAS + 파일 + 이벤트)", async () => {
    await commitGeneratedTransition(baseArgs);
    expect(h.calls.taskUpdate).toMatchObject({ where: { id: "t1", status: "PENDING" }, data: { status: "GENERATED" } });
    expect(h.calls.fileCreate).toBeDefined();
    expect(h.calls.eventCreate).toMatchObject({ data: { taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED" } });
  });

  it("lease가 steal됨(holder 불일치) → ConflictError, status CAS 미수행", async () => {
    h.ret.lockRows = [{ holder: "other-req" }];
    await expect(commitGeneratedTransition(baseArgs)).rejects.toBeInstanceOf(ConflictError);
    expect(h.calls.taskUpdate).toBeUndefined(); // 가드가 먼저 막아 status 변경 안 함
    expect(h.calls.fileCreate).toBeUndefined();
  });

  it("lease row 소멸(release됨) → ConflictError", async () => {
    h.ret.lockRows = [];
    await expect(commitGeneratedTransition(baseArgs)).rejects.toBeInstanceOf(ConflictError);
    expect(h.calls.taskUpdate).toBeUndefined();
  });

  it("status CAS 0행(이미 전이됨) → ConflictError", async () => {
    h.ret.taskUpdateCount = 0;
    await expect(commitGeneratedTransition(baseArgs)).rejects.toBeInstanceOf(ConflictError);
  });

  it("billing roundDate: 기존 행 없으면 create(I3, 덮어쓰기 금지)", async () => {
    await commitGeneratedTransition({ ...baseArgs, roundDate: { year: 2026, round: 2, submitDate: new Date("2026-03-10T01:00:00Z") } });
    expect(h.calls.roundFind).toBeDefined();
    expect(h.calls.roundCreate).toBeDefined();
  });

  it("billing roundDate: 기존 행 있으면 create 안 함(I3)", async () => {
    h.ret.existingRound = { id: "rd-existing" };
    await commitGeneratedTransition({ ...baseArgs, roundDate: { year: 2026, round: 2, submitDate: new Date("2026-03-10T01:00:00Z") } });
    expect(h.calls.roundCreate).toBeUndefined();
  });
});
