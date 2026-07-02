import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => ({ user: { id: "u1", systemRole: "MEMBER" } })),
  listMailContacts: vi.fn(async (): Promise<unknown> => [] as unknown[]),
  addMailContact: vi.fn(async () => ({ id: "c1", email: "a@x.com", name: "홍", memo: null })),
  editMailContact: vi.fn(async (): Promise<unknown> => ({ id: "c1", email: "a@x.com", name: "김", memo: null })),
  removeMailContact: vi.fn(async () => true),
  getRecipientSets: vi.fn(async (): Promise<unknown> => [] as unknown[]),
  saveRecipientSet: vi.fn(async (): Promise<unknown> => ({})),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
// mapError(api/workflows/_shared)가 @/kernel/access의 ForbiddenError를 import — 실 kernel 로드를 피해 mock(관례).
vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/services/mail-recipients", () => ({
  listMailContacts: (...a: unknown[]) => (h.listMailContacts as (...args: unknown[]) => unknown)(...a),
  addMailContact: (...a: unknown[]) => (h.addMailContact as (...args: unknown[]) => unknown)(...a),
  editMailContact: (...a: unknown[]) => (h.editMailContact as (...args: unknown[]) => unknown)(...a),
  removeMailContact: (...a: unknown[]) => (h.removeMailContact as (...args: unknown[]) => unknown)(...a),
  getRecipientSets: (...a: unknown[]) => (h.getRecipientSets as (...args: unknown[]) => unknown)(...a),
  saveRecipientSet: (...a: unknown[]) => (h.saveRecipientSet as (...args: unknown[]) => unknown)(...a),
}));

import { ForbiddenError } from "@/kernel/access";
import { GET as contactsGET, POST as contactsPOST } from "@/app/api/workflows/mail/contacts/route";
import { PATCH as contactPATCH, DELETE as contactDELETE } from "@/app/api/workflows/mail/contacts/[id]/route";
import { GET as setsGET } from "@/app/api/workflows/mail/recipients/route";
import { PUT as setPUT } from "@/app/api/workflows/mail/recipients/[kind]/route";
import { ConflictError } from "@/modules/workflows/types";

const req = (body?: unknown, method = "POST") =>
  new Request("http://t/x", body !== undefined ? { method, body: JSON.stringify(body) } : { method });
const idParams = { params: Promise.resolve({ id: "c1" }) };
const kindParams = (kind: string) => ({ params: Promise.resolve({ kind }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", systemRole: "MEMBER" } });
  h.editMailContact.mockResolvedValue({ id: "c1", email: "a@x.com", name: "김", memo: null });
  h.removeMailContact.mockResolvedValue(true);
  h.saveRecipientSet.mockResolvedValue({ "1": { to: ["a@x.com"], cc: [], bcc: [] } });
});

describe("게이트(D6 — 서비스가 권위, 라우트는 401 + ForbiddenError→403)", () => {
  it("미인증 → 401 (전 라우트 대표로 GET contacts)", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await contactsGET()).status).toBe(401);
  });
  it("서비스 권한 거부(ForbiddenError) → 403 (읽기 포함)", async () => {
    h.listMailContacts.mockRejectedValueOnce(new ForbiddenError("forbidden"));
    expect((await contactsGET()).status).toBe(403);
    h.getRecipientSets.mockRejectedValueOnce(new ForbiddenError("forbidden"));
    expect((await setsGET()).status).toBe(403);
  });
  it("서비스에 userId가 전달된다(게이트 재료)", async () => {
    await contactsGET();
    expect(h.listMailContacts).toHaveBeenCalledWith("u1");
  });
});

describe("contacts CRUD", () => {
  it("POST: 유효 입력 → 201 + 서비스 전달(userId 포함)", async () => {
    const res = await contactsPOST(req({ email: "a@x.com", name: "홍", memo: "m" }));
    expect(res.status).toBe(201);
    expect(h.addMailContact).toHaveBeenCalledWith("u1", { email: "a@x.com", name: "홍", memo: "m" });
  });
  it("POST: 비이메일 → 400", async () => {
    expect((await contactsPOST(req({ email: "nope", name: "홍" }))).status).toBe(400);
  });
  it("POST: 유니크 충돌(ConflictError) → 409", async () => {
    h.addMailContact.mockRejectedValueOnce(new ConflictError("이미 등록된 이메일입니다."));
    expect((await contactsPOST(req({ email: "a@x.com", name: "홍" }))).status).toBe(409);
  });
  it("PATCH: body에 email 포함 → 400(D15 — strictObject)", async () => {
    const res = await contactPATCH(req({ email: "new@x.com", name: "김" }, "PATCH"), idParams);
    expect(res.status).toBe(400);
    expect(h.editMailContact).not.toHaveBeenCalled();
  });
  it("PATCH: name·memo만 → 200", async () => {
    expect((await contactPATCH(req({ name: "김", memo: "m" }, "PATCH"), idParams)).status).toBe(200);
  });
  it("PATCH: 대상 없음 → 404", async () => {
    h.editMailContact.mockResolvedValueOnce(null);
    expect((await contactPATCH(req({ name: "김" }, "PATCH"), idParams)).status).toBe(404);
  });
  it("DELETE: 성공 200 / 대상 없음 404", async () => {
    expect((await contactDELETE(req(undefined, "DELETE"), idParams)).status).toBe(200);
    h.removeMailContact.mockResolvedValueOnce(false);
    expect((await contactDELETE(req(undefined, "DELETE"), idParams)).status).toBe(404);
  });
});

describe("recipients 세트", () => {
  const FULL = {
    "1": { to: ["a@x.com"], cc: [], bcc: [] },
    "2": { to: [], cc: [], bcc: [] },
  };
  it("PUT: D7 파생 kind·전체 step 맵 → 200 + 서비스 전달(userId 포함)", async () => {
    const res = await setPUT(req(FULL, "PUT"), kindParams("BILLING"));
    expect(res.status).toBe(200);
    expect(h.saveRecipientSet).toHaveBeenCalledWith("u1", "BILLING", FULL);
  });
  it("PUT: 파생 밖 kind(WEEKLY_REPORT — 발송 step 없음) → 400", async () => {
    expect((await setPUT(req({}, "PUT"), kindParams("WEEKLY_REPORT"))).status).toBe(400);
    expect(h.saveRecipientSet).not.toHaveBeenCalled();
  });
  it("PUT: 파생 밖 step 키(초과) → 400", async () => {
    const body = { ...FULL, "9": { to: ["a@x.com"], cc: [], bcc: [] } };
    expect((await setPUT(req(body, "PUT"), kindParams("BILLING"))).status).toBe(400);
  });
  it("PUT: step 누락(부분 body) → 400 — 전체 교체가 다른 단계 세트를 지우지 못함", async () => {
    const partial = { "1": { to: ["a@x.com"], cc: [], bcc: [] } }; // "2" 누락
    expect((await setPUT(req(partial, "PUT"), kindParams("BILLING"))).status).toBe(400);
    expect((await setPUT(req({}, "PUT"), kindParams("BILLING"))).status).toBe(400); // 빈 body도 거부
    expect(h.saveRecipientSet).not.toHaveBeenCalled();
  });
  it("PUT: 필드에 비이메일 → 400", async () => {
    const body = { ...FULL, "1": { to: ["nope"], cc: [], bcc: [] } };
    expect((await setPUT(req(body, "PUT"), kindParams("BILLING"))).status).toBe(400);
  });
  it("PUT: WorkflowType 행 없음(null) → 404", async () => {
    h.saveRecipientSet.mockResolvedValueOnce(null);
    expect((await setPUT(req(FULL, "PUT"), kindParams("BILLING"))).status).toBe(404);
  });
});
