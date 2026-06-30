import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const tx = { $executeRaw: vi.fn(), workflowTask: { updateMany: vi.fn() }, workflowTaskEvent: { create: vi.fn() } };
  return { prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)), __tx: tx } };
});

import { prisma } from "@/lib/prisma";
import { cancelTaskAtomic } from "@/modules/workflows/repositories";

const tx = (prisma as unknown as { __tx: { $executeRaw: ReturnType<typeof vi.fn>; workflowTask: { updateMany: ReturnType<typeof vi.fn> }; workflowTaskEvent: { create: ReturnType<typeof vi.fn> } } }).__tx;

beforeEach(() => { tx.$executeRaw.mockReset(); tx.workflowTask.updateMany.mockReset(); tx.workflowTaskEvent.create.mockReset(); });

describe("cancelTaskAtomic (H1)", () => {
  it("GENERATED: 조건부 UPDATE 1행 → 이벤트 기록 + true", async () => {
    tx.$executeRaw.mockResolvedValue(1);
    expect(await cancelTaskAtomic("t1", "GENERATED", "u1")).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.workflowTaskEvent.create).toHaveBeenCalled();
  });
  it("GENERATED but SENDING 존재 → 0행 → false(이벤트 없음, 발송된 작업 보호)", async () => {
    tx.$executeRaw.mockResolvedValue(0);
    expect(await cancelTaskAtomic("t1", "GENERATED", "u1")).toBe(false);
    expect(tx.workflowTaskEvent.create).not.toHaveBeenCalled();
  });
  it("PENDING: 일반 status CAS(updateMany), SENDING 검사 없음", async () => {
    tx.workflowTask.updateMany.mockResolvedValue({ count: 1 });
    expect(await cancelTaskAtomic("t1", "PENDING", "u1")).toBe(true);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.workflowTask.updateMany).toHaveBeenCalled();
  });
});
