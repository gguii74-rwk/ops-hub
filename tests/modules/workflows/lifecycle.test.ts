import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/modules/workflows/repositories", () => ({
  findTaskForTransition: vi.fn(),
  findWorkflowTypeKind: vi.fn(),
  createTaskWithInitialEvent: vi.fn(),
  applyTransitionAtomic: vi.fn(),
  hasActiveSending: vi.fn(),
  cancelTaskAtomic: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import * as repo from "@/modules/workflows/repositories";
import { transitionTask, createTask, cancelTask } from "@/modules/workflows/services/lifecycle";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const baseCtx = (over: Partial<{ userId: string; isOwner: boolean; keys: string[]; note: string }> = {}) => ({
  userId: over.userId ?? "u1",
  isOwner: over.isOwner ?? false,
  permissionKeys: new Set(over.keys ?? []),
  note: over.note,
});

beforeEach(() => {
  for (const k of Object.keys(m)) m[k].mockReset();
  m.applyTransitionAtomic.mockResolvedValue(true);
  m.hasActiveSending.mockResolvedValue(false);
  m.cancelTaskAtomic.mockResolvedValue(true);
});

describe("transitionTask", () => {
  it("허용 전이 + 권한 보유 → applyTransitionAtomic을 stampField와 함께 호출", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await transitionTask("t1", "GENERATED", baseCtx({ keys: ["workflows.weekly:generate"] }));
    expect(m.applyTransitionAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", fromStatus: "PENDING", toStatus: "GENERATED", actorId: "u1", stampField: "generatedAt" }),
    );
  });

  it("정책에 없는 전이 → ConflictError, applyTransitionAtomic 미호출", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await expect(transitionTask("t1", "SENT", baseCtx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ConflictError);
    expect(m.applyTransitionAtomic).not.toHaveBeenCalled();
  });

  it("권한 없음 → ForbiddenError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await expect(transitionTask("t1", "GENERATED", baseCtx({ keys: [] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("OWNER는 권한 키 없이도 허용 전이 통과", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "GENERATED", createdById: "other", kind: "WEEKLY_REPORT" });
    await transitionTask("t1", "SENT", baseCtx({ isOwner: true }));
    expect(m.applyTransitionAtomic).toHaveBeenCalled();
  });

  it("취소: 본인이면 통과(cancelTaskAtomic 호출)", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await transitionTask("t1", "CANCELLED", baseCtx({ keys: ["workflows.weekly:view"] }));
    expect(m.cancelTaskAtomic).toHaveBeenCalledWith("t1", "PENDING", "u1", undefined);
    expect(m.applyTransitionAtomic).not.toHaveBeenCalled();
  });

  it("취소: 본인도 OWNER도 아니면 ForbiddenError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "other", kind: "WEEKLY_REPORT" });
    await expect(transitionTask("t1", "CANCELLED", baseCtx({ keys: ["workflows.weekly:view"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("취소: cancelTaskAtomic false(SENDING 존재 등) → ConflictError(H1 원자 거부)", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "GENERATED", createdById: "u1", kind: "WEEKLY_REPORT" });
    m.cancelTaskAtomic.mockResolvedValue(false);
    await expect(transitionTask("t1", "CANCELLED", baseCtx({ keys: ["workflows.weekly:view"] }))).rejects.toBeInstanceOf(ConflictError);
    expect(m.applyTransitionAtomic).not.toHaveBeenCalled();
  });

  it("경합(applyTransitionAtomic false) → ConflictError", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    m.applyTransitionAtomic.mockResolvedValue(false);
    await expect(transitionTask("t1", "GENERATED", baseCtx({ keys: ["workflows.weekly:generate"] }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("작업 없음 → ForbiddenError", async () => {
    m.findTaskForTransition.mockResolvedValue(null);
    await expect(transitionTask("nope", "GENERATED", baseCtx({ keys: ["workflows.weekly:generate"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createTask", () => {
  it("알 수 없는 typeId → ForbiddenError", async () => {
    m.findWorkflowTypeKind.mockResolvedValue(null);
    await expect(createTask({ typeId: "x", scheduledAt: new Date() }, baseCtx({ keys: ["workflows.weekly:create"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("create 권한 없음 → ForbiddenError", async () => {
    m.findWorkflowTypeKind.mockResolvedValue("WEEKLY_REPORT");
    await expect(createTask({ typeId: "wf-weekly", scheduledAt: new Date() }, baseCtx({ keys: [] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("권한 보유 → createTaskWithInitialEvent 호출", async () => {
    m.findWorkflowTypeKind.mockResolvedValue("WEEKLY_REPORT");
    m.createTaskWithInitialEvent.mockResolvedValue({ id: "new" });
    const out = await createTask({ typeId: "wf-weekly", scheduledAt: new Date("2026-06-20") }, baseCtx({ keys: ["workflows.weekly:create"] }));
    expect(out).toEqual({ id: "new" });
    expect(m.createTaskWithInitialEvent).toHaveBeenCalledWith({ typeId: "wf-weekly", scheduledAt: new Date("2026-06-20"), createdById: "u1" });
  });
});

describe("cancelTask", () => {
  it("transitionTask(CANCELLED)로 위임 → cancelTaskAtomic 호출", async () => {
    m.findTaskForTransition.mockResolvedValue({ id: "t1", status: "PENDING", createdById: "u1", kind: "WEEKLY_REPORT" });
    await cancelTask("t1", baseCtx({ keys: ["workflows.weekly:view"] }));
    expect(m.cancelTaskAtomic).toHaveBeenCalledWith("t1", "PENDING", "u1", undefined);
  });
});
