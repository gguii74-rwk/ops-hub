# Task 06 — 주소록·세트 관리 API(D6·D7·D15)

주소록 CRUD와 타입×단계 기본 세트 GET/PUT을 만든다. 게이트 = `admin.settings:configure` ∧ `workflows.mail:configure` 교집합(읽기·쓰기 동일, D6). 편집 가능 kind×step = D7 파생만.

## Files
- Create: `src/modules/workflows/repositories/mail-recipients.ts`
- Create: `src/modules/workflows/services/mail-recipients.ts`
- Modify: `src/modules/workflows/validations/index.ts` (스키마 3종 추가)
- Create: `src/app/api/workflows/mail/contacts/route.ts` (GET/POST)
- Create: `src/app/api/workflows/mail/contacts/[id]/route.ts` (PATCH/DELETE)
- Create: `src/app/api/workflows/mail/recipients/route.ts` (GET)
- Create: `src/app/api/workflows/mail/recipients/[kind]/route.ts` (PUT)
- Test: `tests/modules/workflows/mail-recipients-service.test.ts` (신규)
- Test: `tests/app/api/workflows/mail-recipients-routes.test.ts` (신규)

## Prep
- 엔트리포인트 §SC-2(타입·normalizeStoredEmails), §SC-3(정책 파생), §SC-8(API 표면 전체).
- 참조: `src/app/api/admin/settings/[key]/route.ts`(게이트를 키 조회보다 먼저 — 열거 방지 정신), `src/modules/workflows/repositories/mail.ts`(P2002→ConflictError 관례), `tests/app/api/workflows/calendar-route.test.ts`(라우트 테스트 mock 관례).

## Deps
- Task 01(recipients.ts·policy 파생·`prisma.mailContact` client).

## Cautions
- **Don't PATCH가 email 필드를 허용·무시(strip)하게 하지 마라.** Reason: D15 — email 불변. `z.strictObject`로 email 포함 body는 400(조용한 무시는 "고쳤다고 오인" 경로).
- **Don't 게이트를 둘 중 하나만 검사하지 마라.** Reason: D6 — 교집합(∧). 읽기(GET)도 동일 게이트.
- **Don't D7 파생 밖 kind/step을 저장하지 마라.** Reason: 소비처 없는 死설정 재생산. kind 400·step 400.
- **Don't PUT에서 부분 step body를 허용하지 마라.** Reason: 전체 교체(§4.3) 계약에서 누락 step은 다른 단계 세트를 조용히 지운다(R1 high) — step 키 집합이 파생과 정확 일치해야 통과.
- **Don't 주소록 삭제 시 세트에서 email을 제거하지 마라.** Reason: D12 — 주소록은 식별 보조(참조 무결성 대상 아님). 세트 잔존 email 유효.
- **Don't `WorkflowType.defaultRecipients`에 정규화 전 원본을 저장하지 마라.** Reason: §3 — trim·소문자·dedup 저장(주소록 조인 매칭 일관).

## TDD Steps

### 1. validations 추가 (테스트는 service·route에서 커버)

`src/modules/workflows/validations/index.ts` 하단에 추가:

```ts
// --- mail recipients (메일 수신자 — 주소록·타입×단계 세트) ---
export const mailContactCreateSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1),
  memo: z.string().max(500).optional(),
});
// D15: email 불변 — strictObject라 email 등 여분 키가 body에 있으면 400.
export const mailContactUpdateSchema = z.strictObject({
  name: z.string().trim().min(1),
  memo: z.string().max(500).optional(),
});
const emailListSchema = z.array(z.string().trim().email());
export const recipientFieldsSchema = z.object({ to: emailListSchema, cc: emailListSchema, bcc: emailListSchema });
// step 키 → 필드. 허용 step(D7 파생) 검사는 라우트에서.
export const recipientSetPutSchema = z.record(z.string(), recipientFieldsSchema);
```

### 2. repository + service — 실패 테스트 먼저

`tests/modules/workflows/mail-recipients-service.test.ts` 생성(레포를 mock — 게이트는 라우트 테스트에서):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock("@/modules/workflows/repositories/mail-recipients", () => ({
  listContacts: vi.fn(async () => []),
  createContact: vi.fn(),
  updateContactNameMemo: vi.fn(),
  deleteContactById: vi.fn(),
  findContactNamesByEmails: vi.fn(async () => new Map()),
  findDefaultRecipientsByKind: vi.fn(async () => null),
  updateDefaultRecipientsByKind: vi.fn(async () => true),
}));

import * as repo from "@/modules/workflows/repositories/mail-recipients";
import {
  addMailContact, editMailContact, getRecipientSets, saveRecipientSet,
} from "@/modules/workflows/services/mail-recipients";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  m.findDefaultRecipientsByKind.mockResolvedValue(null);
  m.updateDefaultRecipientsByKind.mockResolvedValue(true);
});

describe("addMailContact / editMailContact", () => {
  it("email은 trim+소문자로 정규화 저장(D2), memo 공백은 null", async () => {
    m.createContact.mockResolvedValue({ id: "c1", email: "a@x.com", name: "홍길동", memo: null });
    await addMailContact({ email: " A@X.com ", name: " 홍길동 ", memo: "  " });
    expect(m.createContact).toHaveBeenCalledWith({ email: "a@x.com", name: "홍길동", memo: null });
  });
  it("수정은 name·memo만 레포에 전달(D15 — email 인자 자체가 없음)", async () => {
    m.updateContactNameMemo.mockResolvedValue({ id: "c1", email: "a@x.com", name: "김철수", memo: "회계" });
    await editMailContact("c1", { name: "김철수", memo: "회계" });
    expect(m.updateContactNameMemo).toHaveBeenCalledWith("c1", { name: "김철수", memo: "회계" });
  });
});

describe("getRecipientSets (D7 파생)", () => {
  it("mailRecipientKinds만 — BILLING steps ['1','2'], 미저장 step은 빈 필드", async () => {
    m.findDefaultRecipientsByKind.mockResolvedValue({ "1": { to: ["a@x.com"], cc: [], bcc: [] } });
    const sets = await getRecipientSets();
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
    const out = await saveRecipientSet("BILLING", {
      "1": { to: [" A@X.com ", "a@x.com"], cc: ["B@x.com"], bcc: [] },
    });
    expect(m.updateDefaultRecipientsByKind).toHaveBeenCalledWith("BILLING", {
      "1": { to: ["a@x.com"], cc: ["b@x.com"], bcc: [] },
    });
    expect(out).toEqual({ "1": { to: ["a@x.com"], cc: ["b@x.com"], bcc: [] } });
  });
  it("WorkflowType 행 없으면 null(라우트 404)", async () => {
    m.updateDefaultRecipientsByKind.mockResolvedValue(false);
    expect(await saveRecipientSet("BILLING", {})).toBeNull();
  });
});
```

실행: `npm test -- tests/modules/workflows/mail-recipients-service.test.ts` → **FAIL**.

### 3. repository 구현

`src/modules/workflows/repositories/mail-recipients.ts` 생성:

```ts
import "server-only";
import { Prisma } from "@prisma/client";
import type { WorkflowKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "../types";
import { parseDefaultRecipients, type DefaultRecipientsMap } from "../recipients";

export interface MailContactRow { id: string; email: string; name: string; memo: string | null }
const CONTACT_SELECT = { id: true, email: true, name: true, memo: true } as const;

export async function listContacts(): Promise<MailContactRow[]> {
  return prisma.mailContact.findMany({ select: CONTACT_SELECT, orderBy: { email: "asc" } });
}

export async function createContact(data: { email: string; name: string; memo: string | null }): Promise<MailContactRow> {
  try {
    return await prisma.mailContact.create({ data, select: CONTACT_SELECT });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("이미 등록된 이메일입니다.");
    }
    throw e;
  }
}

// D15: email 불변 — name·memo만 갱신. 대상 없으면 null(라우트 404).
export async function updateContactNameMemo(id: string, data: { name: string; memo: string | null }): Promise<MailContactRow | null> {
  try {
    return await prisma.mailContact.update({ where: { id }, data, select: CONTACT_SELECT });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return null;
    throw e;
  }
}

export async function deleteContactById(id: string): Promise<boolean> {
  try {
    await prisma.mailContact.delete({ where: { id } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return false;
    throw e;
  }
}

// D8 enrich용 — 세트에 등장한 email만 조회(주소록 전체 미노출). 키 = 소문자 email(D2 저장 규약과 일치).
export async function findContactNamesByEmails(emails: string[]): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const rows = await prisma.mailContact.findMany({
    where: { email: { in: [...new Set(emails.map((e) => e.toLowerCase()))] } },
    select: { email: true, name: true },
  });
  return new Map(rows.map((r) => [r.email, r.name]));
}

export async function findDefaultRecipientsByKind(kind: WorkflowKind): Promise<DefaultRecipientsMap | null> {
  const t = await prisma.workflowType.findUnique({ where: { kind }, select: { defaultRecipients: true } });
  if (!t) return null;
  return parseDefaultRecipients(t.defaultRecipients);
}

// 전체 교체 저장(§4.3). WorkflowType 행 없으면 false(라우트 404).
export async function updateDefaultRecipientsByKind(kind: WorkflowKind, map: DefaultRecipientsMap): Promise<boolean> {
  try {
    await prisma.workflowType.update({ where: { kind }, data: { defaultRecipients: map as unknown as Prisma.InputJsonValue } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return false;
    throw e;
  }
}
```

### 4. service 구현

`src/modules/workflows/services/mail-recipients.ts` 생성:

```ts
import "server-only";
import type { WorkflowKind } from "@prisma/client";
import { hasPermission } from "@/kernel/access";
import { mailRecipientKinds, sendStepsForKind } from "../policy";
import { normalizeStoredEmails, type DefaultRecipientsMap, type RecipientFields } from "../recipients";
import {
  listContacts, createContact, updateContactNameMemo, deleteContactById,
  findDefaultRecipientsByKind, updateDefaultRecipientsByKind,
} from "../repositories/mail-recipients";

// D6: 관리 읽기·쓰기 동일 교집합 게이트. 관리 페이지(서버 게이트)와 API 라우트가 이 헬퍼로
// 같은 키를 공유한다(접근제어 규칙①). OWNER는 hasPermission이 자동 허용. 둘 중 하나라도 없으면 거부(fail-closed).
export async function canManageMailRecipients(userId: string): Promise<boolean> {
  return (
    (await hasPermission(userId, "admin.settings", "configure")) &&
    (await hasPermission(userId, "workflows.mail", "configure"))
  );
}

export interface MailContactView { id: string; email: string; name: string; memo: string | null }

export async function listMailContacts(): Promise<MailContactView[]> {
  return listContacts();
}

// email은 trim+소문자로 정규화 저장(D2). 유니크 충돌은 레포가 ConflictError로 정규화 → 라우트 409.
export async function addMailContact(input: { email: string; name: string; memo?: string }): Promise<MailContactView> {
  return createContact({
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    memo: input.memo?.trim() ? input.memo.trim() : null,
  });
}

export async function editMailContact(id: string, input: { name: string; memo?: string }): Promise<MailContactView | null> {
  return updateContactNameMemo(id, {
    name: input.name.trim(),
    memo: input.memo?.trim() ? input.memo.trim() : null,
  });
}

export async function removeMailContact(id: string): Promise<boolean> {
  return deleteContactById(id); // 세트 잔존 email과 무관(D12)
}

export interface RecipientSetView { kind: WorkflowKind; steps: string[]; recipients: DefaultRecipientsMap }

// D7: SEND_STEP_TRANSITION 파생 kind만 노출. 미저장 step은 빈 필드로 채워 UI가 바로 그린다.
export async function getRecipientSets(): Promise<RecipientSetView[]> {
  const out: RecipientSetView[] = [];
  for (const kind of mailRecipientKinds()) {
    const stored = (await findDefaultRecipientsByKind(kind)) ?? {};
    const steps = sendStepsForKind(kind);
    const recipients: DefaultRecipientsMap = {};
    for (const step of steps) recipients[step] = stored[step] ?? { to: [], cc: [], bcc: [] };
    out.push({ kind, steps, recipients });
  }
  return out;
}

// 전체 교체 저장. 필드별 trim·소문자·dedup(§3 — 주소록 조인 매칭 일관). kind·step 검증은 라우트(400).
export async function saveRecipientSet(kind: WorkflowKind, map: Record<string, RecipientFields>): Promise<DefaultRecipientsMap | null> {
  const normalized: DefaultRecipientsMap = {};
  for (const [step, f] of Object.entries(map)) {
    normalized[step] = { to: normalizeStoredEmails(f.to), cc: normalizeStoredEmails(f.cc), bcc: normalizeStoredEmails(f.bcc) };
  }
  const ok = await updateDefaultRecipientsByKind(kind, normalized);
  return ok ? normalized : null;
}
```

실행: `npm test -- tests/modules/workflows/mail-recipients-service.test.ts` → **PASS**.

### 5. 라우트 — 실패 테스트 먼저

`tests/app/api/workflows/mail-recipients-routes.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => ({ user: { id: "u1", systemRole: "MEMBER" } })),
  canManage: vi.fn(async () => true),
  listMailContacts: vi.fn(async () => [] as unknown[]),
  addMailContact: vi.fn(async () => ({ id: "c1", email: "a@x.com", name: "홍", memo: null })),
  editMailContact: vi.fn(async (): Promise<unknown> => ({ id: "c1", email: "a@x.com", name: "김", memo: null })),
  removeMailContact: vi.fn(async () => true),
  getRecipientSets: vi.fn(async () => [] as unknown[]),
  saveRecipientSet: vi.fn(async (): Promise<unknown> => ({})),
}));
vi.mock("@/lib/auth", () => ({ auth: () => h.auth() }));
// mapError(api/workflows/_shared)가 @/kernel/access의 ForbiddenError를 import — 실 kernel 로드를 피해 mock(관례).
vi.mock("@/kernel/access", () => ({
  ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } },
}));
vi.mock("@/modules/workflows/services/mail-recipients", () => ({
  canManageMailRecipients: (...a: unknown[]) => (h.canManage as (...args: unknown[]) => unknown)(...a),
  listMailContacts: () => h.listMailContacts(),
  addMailContact: (...a: unknown[]) => (h.addMailContact as (...args: unknown[]) => unknown)(...a),
  editMailContact: (...a: unknown[]) => (h.editMailContact as (...args: unknown[]) => unknown)(...a),
  removeMailContact: (...a: unknown[]) => (h.removeMailContact as (...args: unknown[]) => unknown)(...a),
  getRecipientSets: () => h.getRecipientSets(),
  saveRecipientSet: (...a: unknown[]) => (h.saveRecipientSet as (...args: unknown[]) => unknown)(...a),
}));

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
  h.canManage.mockResolvedValue(true);
  h.editMailContact.mockResolvedValue({ id: "c1", email: "a@x.com", name: "김", memo: null });
  h.removeMailContact.mockResolvedValue(true);
  h.saveRecipientSet.mockResolvedValue({ "1": { to: ["a@x.com"], cc: [], bcc: [] } });
});

describe("게이트(D6 교집합 — 읽기 포함)", () => {
  it("미인증 → 401 (전 라우트 대표로 GET contacts)", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect((await contactsGET()).status).toBe(401);
  });
  it("교집합 게이트 실패 → 403, 서비스 미호출", async () => {
    h.canManage.mockResolvedValue(false);
    expect((await contactsGET()).status).toBe(403);
    expect((await setsGET()).status).toBe(403);
    expect(h.listMailContacts).not.toHaveBeenCalled();
    expect(h.getRecipientSets).not.toHaveBeenCalled();
  });
});

describe("contacts CRUD", () => {
  it("POST: 유효 입력 → 201 + 서비스 전달", async () => {
    const res = await contactsPOST(req({ email: "a@x.com", name: "홍", memo: "m" }));
    expect(res.status).toBe(201);
    expect(h.addMailContact).toHaveBeenCalledWith({ email: "a@x.com", name: "홍", memo: "m" });
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
  it("PUT: D7 파생 kind·전체 step 맵 → 200 + 서비스 전달", async () => {
    const res = await setPUT(req(FULL, "PUT"), kindParams("BILLING"));
    expect(res.status).toBe(200);
    expect(h.saveRecipientSet).toHaveBeenCalledWith("BILLING", FULL);
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
```

실행: `npm test -- tests/app/api/workflows/mail-recipients-routes.test.ts` → **FAIL**(라우트 없음).

### 6. 라우트 구현

`src/app/api/workflows/mail/contacts/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { mailContactCreateSchema } from "@/modules/workflows/validations";
import { addMailContact, canManageMailRecipients, listMailContacts } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../_shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await canManageMailRecipients(session.user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const contacts = await listMailContacts();
  return NextResponse.json({ contacts }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await canManageMailRecipients(session.user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const input = mailContactCreateSchema.parse(await req.json());
    const contact = await addMailContact(input);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e); // ConflictError(email 유니크) → 409
  }
}
```

`src/app/api/workflows/mail/contacts/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { mailContactUpdateSchema } from "@/modules/workflows/validations";
import { canManageMailRecipients, editMailContact, removeMailContact } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../../_shared";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await canManageMailRecipients(session.user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    // D15: email 불변 — strictObject라 email 포함 body는 ZodError → 400.
    const input = mailContactUpdateSchema.parse(await req.json());
    const contact = await editMailContact(id, input);
    if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ contact });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await canManageMailRecipients(session.user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const ok = await removeMailContact(id); // 세트 잔존 email 무관(D12)
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

`src/app/api/workflows/mail/recipients/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canManageMailRecipients, getRecipientSets } from "@/modules/workflows/services/mail-recipients";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await canManageMailRecipients(session.user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sets = await getRecipientSets();
  return NextResponse.json({ sets }, { headers: { "Cache-Control": "no-store" } });
}
```

`src/app/api/workflows/mail/recipients/[kind]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { WorkflowKind } from "@prisma/client";
import { auth } from "@/lib/auth";
import { mailRecipientKinds, sendStepsForKind } from "@/modules/workflows/policy";
import { recipientSetPutSchema } from "@/modules/workflows/validations";
import { canManageMailRecipients, saveRecipientSet } from "@/modules/workflows/services/mail-recipients";
import { mapError } from "../../../_shared";

export async function PUT(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await canManageMailRecipients(session.user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { kind: kindRaw } = await params;
  // D7: 발송 단계가 정의된 kind만(파생 단일 출처). 그 외 kind의 세트는 소비처 없는 死설정 — 400.
  if (!(mailRecipientKinds() as string[]).includes(kindRaw)) {
    return NextResponse.json({ error: "unsupported kind" }, { status: 400 });
  }
  const kind = kindRaw as WorkflowKind;
  try {
    const body = recipientSetPutSchema.parse(await req.json());
    // 전체 교체(§4.3) 계약 강제: step 키 집합이 D7 파생과 **정확히 일치**해야 한다. 초과 step은 死설정,
    // 누락 step은 부분 body가 다른 단계 세트를 조용히 지우는 경로(R1 high) — 둘 다 400.
    const required = sendStepsForKind(kind);
    const keys = Object.keys(body);
    if (required.some((s) => !keys.includes(s)) || keys.some((s) => !required.includes(s))) {
      return NextResponse.json({ error: `step set mismatch (required: ${required.join(",")})` }, { status: 400 });
    }
    const recipients = await saveRecipientSet(kind, body);
    if (!recipients) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ kind, recipients });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues }, { status: 400 });
    return mapError(e);
  }
}
```

실행: `npm test -- tests/app/api/workflows/mail-recipients-routes.test.ts` → **PASS**.

### 7. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/modules/workflows/mail-recipients-service.test.ts tests/app/api/workflows/mail-recipients-routes.test.ts
```

전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` → 통과(boundaries 포함 — module→kernel import는 허용 방향).
- 서비스·라우트 테스트 전체 통과.
- 게이트: GET 포함 전 라우트가 D6 교집합. 게이트 실패 시 서비스 미호출.
- PATCH: email 포함 body 400(strip 아님). PUT: 파생 밖 kind 400·step 키 집합 정확 일치(누락·초과 400). POST: 중복 email 409.
- 저장 값: 소문자·trim·dedup 정규화(saveRecipientSet 반환 = DB 기록).
