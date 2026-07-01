import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/modules/workflows/repositories", () => ({
  findTaskList: vi.fn(),
  findTaskDetail: vi.fn(),
  createGeneratedFiles: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import * as repo from "@/modules/workflows/repositories";
import { getTaskList, getTaskDetailView } from "@/modules/workflows/services/tasks";
import { recordGeneratedFiles } from "@/modules/workflows/services/generator";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  m.findTaskList.mockReset().mockResolvedValue([]);
  m.findTaskDetail.mockReset().mockResolvedValue(null);
  m.createGeneratedFiles.mockReset().mockResolvedValue(undefined);
});

describe("getTaskList", () => {
  it(":view 보유 kind만 repo에 전달하고 ISO로 직렬화", async () => {
    m.findTaskList.mockResolvedValue([{ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: new Date("2026-06-12T00:00:00Z"), status: "PENDING" }]);
    const out = await getTaskList({ permissionKeys: new Set(["workflows.weekly:view"]) }, {});
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["WEEKLY_REPORT"] }));
    expect(out[0]).toEqual({ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: "2026-06-12T00:00:00.000Z", status: "PENDING" });
  });

  it("view 권한이 하나도 없으면 kinds=[]로 호출되어 빈 목록", async () => {
    await getTaskList({ permissionKeys: new Set() }, {});
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: [] }));
  });

  it("여러 kind 권한이면 모두 전달", async () => {
    await getTaskList({ permissionKeys: new Set(["workflows.weekly:view", "workflows.billing:view"]) }, { statuses: ["SENT"] });
    const arg = m.findTaskList.mock.calls[0][0];
    expect(arg.kinds.sort()).toEqual(["BILLING", "WEEKLY_REPORT"]);
    expect(arg.statuses).toEqual(["SENT"]);
  });

  it("신규 client kind도 view 보유 시 repo에 전달된다(R1 — ALL_KINDS enum 커버리지)", async () => {
    await getTaskList(
      { permissionKeys: new Set(["workflows.weeklyClient:view", "workflows.monthlyClient:view"]) },
      {},
    );
    const arg = m.findTaskList.mock.calls[0][0];
    expect(arg.kinds.sort()).toEqual(["MONTHLY_REPORT_CLIENT", "WEEKLY_REPORT_CLIENT"]);
  });
});

describe("getTaskDetailView", () => {
  const detail = {
    id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: new Date("2026-06-12T00:00:00Z"), status: "GENERATED",
    createdById: "u1", outputPath: null, recipients: null, defaultRecipients: null,
    files: [{ id: "f1", path: "/o/a.xlsx", displayName: "a.xlsx", mimeType: null, sizeBytes: 123n, createdAt: new Date("2026-06-12T00:00:00Z") }],
    mailDeliveries: [{ id: "m1", step: "send", recipients: ["a@x"], subject: "s", status: "FAILED", errorMessage: "boom", providerMessageId: null, sentAt: null }],
    events: [{ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: new Date("2026-06-12T00:00:00Z") }],
  };

  it("없으면 null", async () => {
    m.findTaskDetail.mockResolvedValue(null);
    expect(await getTaskDetailView("nope", { permissionKeys: new Set(["workflows.weekly:view"]) })).toBeNull();
  });

  it("해당 kind :view 없으면 ForbiddenError", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    await expect(getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view"]) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("권한 있으면 DTO(ISO·Number·timeline) 직렬화", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view"]) });
    expect(out!.scheduledAt).toBe("2026-06-12T00:00:00.000Z");
    expect(out!.files[0]).toEqual({ id: "f1", displayName: "a.xlsx", mimeType: null, sizeBytes: 123, createdAt: "2026-06-12T00:00:00.000Z" });
    expect(out!.mailDeliveries[0]).toEqual({ id: "m1", step: "send", recipients: ["a@x"], subject: "s", status: "FAILED", errorMessage: "boom", sentAt: null });
    expect(out!.timeline[0]).toEqual({ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: "2026-06-12T00:00:00.000Z" });
  });

  it(":send 없으면 effectiveRecipients 미포함(:view-only 비노출, F3)", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: ["a@x"], defaultRecipients: ["b@x"] });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view"]) });
    expect(out!.effectiveRecipients).toBeUndefined();
  });

  it(":send 있으면 task.recipients 우선", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: ["a@x"], defaultRecipients: ["b@x"] });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual(["a@x"]);
  });

  it(":send 있고 task.recipients 비면(null) type.defaultRecipients", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: null, defaultRecipients: ["b@x"] });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual(["b@x"]);
  });

  it(":send 있고 둘 다 없으면 []", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: null, defaultRecipients: null });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual([]);
  });
});

describe("recordGeneratedFiles", () => {
  it("result.files를 createGeneratedFiles로 위임", async () => {
    await recordGeneratedFiles("t1", { files: [{ path: "/o/a.xlsx", displayName: "a.xlsx" }] });
    expect(m.createGeneratedFiles).toHaveBeenCalledWith("t1", [{ path: "/o/a.xlsx", displayName: "a.xlsx" }]);
  });
});
