import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/modules/workflows/repositories", () => ({
  findTaskList: vi.fn(),
  findTaskDetail: vi.fn(),
  createGeneratedFiles: vi.fn(),
}));
vi.mock("@/modules/workflows/repositories/mail-recipients", () => ({
  findContactNamesByEmails: vi.fn(async () => new Map<string, string>()),
}));

import { ForbiddenError } from "@/kernel/access";
import * as repo from "@/modules/workflows/repositories";
import * as contactRepo from "@/modules/workflows/repositories/mail-recipients";
import { getTaskList, getTaskDetailView, getCalendarTasks } from "@/modules/workflows/services/tasks";
import { recordGeneratedFiles } from "@/modules/workflows/services/generator";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const cm = contactRepo as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  m.findTaskList.mockReset().mockResolvedValue([]);
  m.findTaskDetail.mockReset().mockResolvedValue(null);
  m.createGeneratedFiles.mockReset().mockResolvedValue(undefined);
  cm.findContactNamesByEmails.mockReset().mockResolvedValue(new Map());
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
    id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: new Date("2026-06-12T00:00:00Z"), status: "GENERATED",
    createdById: "u1", outputPath: null,
    defaultRecipients: { "1": { to: ["a@x.com"], cc: ["c@x.com"], bcc: ["b@x.com"] } },
    files: [{ id: "f1", path: "/o/a.xlsx", displayName: "a.xlsx", mimeType: null, sizeBytes: 123n, createdAt: new Date("2026-06-12T00:00:00Z") }],
    mailDeliveries: [{ id: "m1", step: "1", recipients: ["a@x"], cc: ["c@x"], bcc: ["b@x"], subject: "s", status: "FAILED", errorMessage: "boom", providerMessageId: null, sentAt: null }],
    events: [{ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: new Date("2026-06-12T00:00:00Z") }],
  };

  it("없으면 null", async () => {
    m.findTaskDetail.mockResolvedValue(null);
    expect(await getTaskDetailView("nope", { permissionKeys: new Set(["workflows.billing:view"]) })).toBeNull();
  });

  it("해당 kind :view 없으면 ForbiddenError", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    await expect(getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view"]) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("권한 있으면 DTO(ISO·Number·timeline) 직렬화", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view"]) });
    expect(out!.scheduledAt).toBe("2026-06-12T00:00:00.000Z");
    expect(out!.files[0]).toEqual({ id: "f1", displayName: "a.xlsx", mimeType: null, sizeBytes: 123, createdAt: "2026-06-12T00:00:00.000Z" });
    expect(out!.mailDeliveries[0]).toEqual({ id: "m1", step: "1", recipients: ["a@x"], cc: ["c@x"], subject: "s", status: "FAILED", errorMessage: "boom", sentAt: null });
    expect(out!.timeline[0]).toEqual({ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: "2026-06-12T00:00:00.000Z" });
  });

  it(":send 없으면 effectiveRecipients 미포함 + mail bcc 필드 부재(D8·D14)", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view"]) });
    expect(out!.effectiveRecipients).toBeUndefined();
    expect(out!.mailDeliveries[0].cc).toEqual(["c@x"]);            // cc는 view 허용
    expect("bcc" in out!.mailDeliveries[0]).toBe(false);           // bcc는 필드 생략
    expect(cm.findContactNamesByEmails).not.toHaveBeenCalled();
  });

  it(":send 보유 → mail bcc 포함 + effectiveRecipients 단계별 맵(미저장 step은 빈 필드)", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    cm.findContactNamesByEmails.mockResolvedValue(new Map([["a@x.com", "홍길동"]]));
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view", "workflows.billing:send"]) });
    expect(out!.mailDeliveries[0].bcc).toEqual(["b@x"]);
    expect(out!.effectiveRecipients).toEqual({
      "1": { to: [{ email: "a@x.com", name: "홍길동" }], cc: [{ email: "c@x.com" }], bcc: [{ email: "b@x.com" }] },
      "2": { to: [], cc: [], bcc: [] },
    });
  });

  it("enrich는 세트 등장 email만 조회(주소록 전체 미노출)", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view", "workflows.billing:send"]) });
    const [emails] = cm.findContactNamesByEmails.mock.calls[0] as [string[]];
    expect([...emails].sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("발송 step 없는 kind(WEEKLY_REPORT)는 빈 맵", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, kind: "WEEKLY_REPORT", defaultRecipients: null });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual({});
  });

  it("기존 행(cc/bcc null) → cc []·bcc [](:send 기준) 호환", async () => {
    m.findTaskDetail.mockResolvedValue({
      ...detail,
      mailDeliveries: [{ ...detail.mailDeliveries[0], cc: null, bcc: null }],
    });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view", "workflows.billing:send"]) });
    expect(out!.mailDeliveries[0].cc).toEqual([]);
    expect(out!.mailDeliveries[0].bcc).toEqual([]);
  });
});

describe("getCalendarTasks (서버 range 계약, D5)", () => {
  it("start<end면 allowed kind + range를 repo에 전달·ISO 직렬화", async () => {
    m.findTaskList.mockResolvedValue([{ id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: new Date("2026-07-10T00:00:00Z"), status: "PENDING" }]);
    const start = new Date("2026-07-01T00:00:00Z");
    const end = new Date("2026-08-12T00:00:00Z");
    const out = await getCalendarTasks({ permissionKeys: new Set(["workflows.billing:view"]) }, { start, end });
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["BILLING"], start, end }));
    expect(out[0]).toEqual({ id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: "2026-07-10T00:00:00.000Z", status: "PENDING" });
  });

  it("start>=end면 RangeError(방어 — 라우트가 먼저 400이지만 서비스도 강제)", async () => {
    const d = new Date("2026-07-01T00:00:00Z");
    await expect(
      getCalendarTasks({ permissionKeys: new Set(["workflows.billing:view"]) }, { start: d, end: d }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("view 권한 없으면 kinds=[]", async () => {
    await getCalendarTasks({ permissionKeys: new Set() }, { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-02T00:00:00Z") });
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: [] }));
  });
});

describe("recordGeneratedFiles", () => {
  it("result.files를 createGeneratedFiles로 위임", async () => {
    await recordGeneratedFiles("t1", { files: [{ path: "/o/a.xlsx", displayName: "a.xlsx" }] });
    expect(m.createGeneratedFiles).toHaveBeenCalledWith("t1", [{ path: "/o/a.xlsx", displayName: "a.xlsx" }]);
  });
});
