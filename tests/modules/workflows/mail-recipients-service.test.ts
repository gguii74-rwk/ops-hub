import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({
  hasPermission: vi.fn(async () => true),
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/repositories/mail-recipients", () => ({
  listContacts: vi.fn(async () => []),
  createContact: vi.fn(),
  updateContactNameMemo: vi.fn(),
  deleteContactById: vi.fn(),
  findContactNamesByEmails: vi.fn(async () => new Map()),
  findDefaultRecipientsByKind: vi.fn(async () => null),
  updateDefaultRecipientsByKind: vi.fn(async () => true),
}));

import { hasPermission, ForbiddenError } from "@/kernel/access";
import * as repo from "@/modules/workflows/repositories/mail-recipients";
import {
  addMailContact, editMailContact, getRecipientSets, listMailContacts, saveRecipientSet,
} from "@/modules/workflows/services/mail-recipients";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const perm = hasPermission as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  perm.mockResolvedValue(true);
  m.findDefaultRecipientsByKind.mockResolvedValue(null);
  m.updateDefaultRecipientsByKind.mockResolvedValue(true);
});

describe("서비스 권한 강제(R3 — 라우트 규율에 미의존, D6 교집합)", () => {
  it("교집합 중 하나라도 결여면 ForbiddenError·레포 미호출(fail-closed)", async () => {
    perm.mockImplementation(async (_u: string, resource: string) => resource !== "workflows.mail");
    await expect(listMailContacts("u1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addMailContact("u1", { email: "a@x.com", name: "홍" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRecipientSet("u1", "BILLING", {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(m.listContacts).not.toHaveBeenCalled();
    expect(m.createContact).not.toHaveBeenCalled();
    expect(m.updateDefaultRecipientsByKind).not.toHaveBeenCalled();
  });
});

describe("addMailContact / editMailContact", () => {
  it("email은 trim+소문자로 정규화 저장(D2), memo 공백은 null", async () => {
    m.createContact.mockResolvedValue({ id: "c1", email: "a@x.com", name: "홍길동", memo: null });
    await addMailContact("u1", { email: " A@X.com ", name: " 홍길동 ", memo: "  " });
    expect(m.createContact).toHaveBeenCalledWith({ email: "a@x.com", name: "홍길동", memo: null });
  });
  it("수정은 name·memo만 레포에 전달(D15 — email 인자 자체가 없음)", async () => {
    m.updateContactNameMemo.mockResolvedValue({ id: "c1", email: "a@x.com", name: "김철수", memo: "회계" });
    await editMailContact("u1", "c1", { name: "김철수", memo: "회계" });
    expect(m.updateContactNameMemo).toHaveBeenCalledWith("c1", { name: "김철수", memo: "회계" });
  });
});

describe("getRecipientSets (D7 파생)", () => {
  it("mailRecipientKinds만 — BILLING steps ['1','2'], 미저장 step은 빈 필드", async () => {
    m.findDefaultRecipientsByKind.mockResolvedValue({ "1": { to: ["a@x.com"], cc: [], bcc: [] } });
    const sets = await getRecipientSets("u1");
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual({
      kind: "BILLING",
      steps: ["1", "2"],
      recipients: {
        "1": { to: ["a@x.com"], cc: [], bcc: [] },
        "2": { to: [], cc: [], bcc: [] },
      },
    });
  });
});

describe("saveRecipientSet", () => {
  it("필드별 trim·소문자·dedup 정규화 후 전체 교체 저장(§3)", async () => {
    const out = await saveRecipientSet("u1", "BILLING", {
      "1": { to: [" A@X.com ", "a@x.com"], cc: ["B@x.com"], bcc: [] },
    });
    expect(m.updateDefaultRecipientsByKind).toHaveBeenCalledWith("BILLING", {
      "1": { to: ["a@x.com"], cc: ["b@x.com"], bcc: [] },
    });
    expect(out).toEqual({ "1": { to: ["a@x.com"], cc: ["b@x.com"], bcc: [] } });
  });
  it("WorkflowType 행 없으면 null(라우트 404)", async () => {
    m.updateDefaultRecipientsByKind.mockResolvedValue(false);
    expect(await saveRecipientSet("u1", "BILLING", {})).toBeNull();
  });
});
