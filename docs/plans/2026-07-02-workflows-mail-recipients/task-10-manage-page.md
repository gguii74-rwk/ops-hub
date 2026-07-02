# Task 10 — 관리 페이지 `/admin/settings/mail-recipients`

주소록 CRUD + 타입×단계 기본 세트 편집 전용 페이지(D9). 서버 게이트 = D6 교집합(API와 동일 키 — `canManageMailRecipients`).

## Files
- Create: `src/app/(app)/admin/settings/mail-recipients/page.tsx`
- Create: `src/app/(app)/admin/settings/mail-recipients/mail-recipients.tsx`
- Test: `tests/app/admin/mail-recipients.test.tsx` (신규)

## Prep
- 엔트리포인트 §SC-8(API 응답 형태), §SC-11(UI 계약).
- 참조: `src/app/(app)/workflows/billing/settings/page.tsx`(서버 게이트·PageSection 관례), `src/app/(app)/workflows/billing/settings/billing-settings.tsx`(useQuery·toast·2-click 삭제 관례), `src/app/(app)/workflows/[id]/send-modal.tsx`(Modal 사용 관례), `src/app/(app)/workflows/labels.ts`(`KIND_LABEL`).

## Deps
- Task 06(관리 API), Task 09(설정 카드 manageHref가 이 경로를 가리킴).

## Cautions
- **Don't 수정 모달에 email 입력 필드를 두지 마라.** Reason: D15 — email 불변(표시 전용). 주소 변경 = 새 등록 + 구 삭제 + 세트 직접 교체(운영 절차).
- **Don't 세트 편집에서 D7 파생 밖 step UI를 만들지 마라.** Reason: 서버 응답 `steps`가 단일 출처 — UI는 응답의 steps만 렌더(향후 kind 확장 시 자동).
- **Don't 클라에서 이메일 형식·소문자 정규화를 구현하지 마라.** Reason: 서버 zod·`normalizeStoredEmails`가 권위(§3). 클라는 쉼표 파싱 + 빈 값 차단만. 400 응답을 토스트로 안내.
- **Don't 주소록 삭제를 세트 사용 여부로 막지 마라.** Reason: D12 — 주소록은 식별 보조. 세트 잔존 email 유효.

## TDD Steps

### 1. 실패 테스트 먼저

`tests/app/admin/mail-recipients.test.tsx` 생성:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn());
const toastErr = vi.hoisted(() => vi.fn());
const toastOk = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  contacts: { data: undefined as unknown, isLoading: false, isError: false },
  sets: { data: undefined as unknown, isLoading: false, isError: false },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => (opts.queryKey[0] === "mail-contacts" ? state.contacts : state.sets),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("sonner", () => ({ toast: { error: toastErr, success: toastOk } }));

import { MailRecipients } from "@/app/(app)/admin/settings/mail-recipients/mail-recipients";

const CONTACTS = { contacts: [{ id: "c1", email: "hong@x.com", name: "홍길동", memo: "고객사 A 회계" }] };
const SETS = {
  sets: [{
    kind: "BILLING", steps: ["1", "2"],
    recipients: {
      "1": { to: ["hong@x.com"], cc: ["etc@x.com"], bcc: [] },
      "2": { to: [], cc: [], bcc: [] },
    },
  }],
};

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); invalidate.mockClear(); toastErr.mockClear(); toastOk.mockClear();
  state.contacts = { data: CONTACTS, isLoading: false, isError: false };
  state.sets = { data: SETS, isLoading: false, isError: false };
});

function setup() {
  state.contacts = { data: CONTACTS, isLoading: false, isError: false };
  state.sets = { data: SETS, isLoading: false, isError: false };
  render(<MailRecipients />);
}

describe("렌더", () => {
  it("주소록 테이블 + 세트 카드(kind 라벨·단계) + 이름 배지·미등록 배지(D12)", () => {
    setup();
    expect(screen.getByText("hong@x.com")).toBeTruthy();
    expect(screen.getByText("대금청구")).toBeTruthy();           // KIND_LABEL
    expect(screen.getByText("1단계")).toBeTruthy();
    expect(screen.getByText("2단계")).toBeTruthy();
    expect(screen.getAllByText("홍길동").length).toBeGreaterThan(0); // 테이블 + 칩 배지
    expect(screen.getByText("주소록 미등록")).toBeTruthy();      // etc@x.com
  });
  it("로드 오류 → ErrorState", () => {
    state.contacts = { data: undefined, isLoading: false, isError: true };
    state.sets = { data: SETS, isLoading: false, isError: false };
    render(<MailRecipients />);
    expect(screen.getByText(/불러오지 못했습니다/)).toBeTruthy();
  });
});

describe("주소록 CRUD", () => {
  it("추가: POST payload(email·name·memo)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByLabelText("추가 이메일"), { target: { value: "new@x.com" } });
    fireEvent.change(screen.getByLabelText("추가 이름"), { target: { value: "김철수" } });
    fireEvent.change(screen.getByLabelText("추가 메모"), { target: { value: "메모" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/mail/contacts");
    expect(JSON.parse(init.body as string)).toEqual({ email: "new@x.com", name: "김철수", memo: "메모" });
  });
  it("추가: 409 → 중복 안내 토스트", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByLabelText("추가 이메일"), { target: { value: "hong@x.com" } });
    fireEvent.change(screen.getByLabelText("추가 이름"), { target: { value: "홍" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("이미 등록된 이메일입니다."));
  });
  it("수정 모달: email은 표시 전용, PATCH body에 name·memo만(D15)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.queryByLabelText("이메일")).toBeNull(); // 입력 필드 아님
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동2" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/mail/contacts/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "홍길동2", memo: "고객사 A 회계" });
  });
  it("삭제: 2-click confirm 후 DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(fetchMock).not.toHaveBeenCalled(); // 1클릭째는 확인 대기
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workflows/mail/contacts/c1", expect.objectContaining({ method: "DELETE" })));
  });
});

describe("세트 저장", () => {
  it("PUT: 전체 맵 payload(자기 kind 전 step 포함)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByLabelText("1단계 참조"), { target: { value: "etc@x.com, new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "대금청구 세트 저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/mail/recipients/BILLING");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      "1": { to: ["hong@x.com"], cc: ["etc@x.com", "new@x.com"], bcc: [] },
      "2": { to: [], cc: [], bcc: [] },
    });
  });
  it("PUT 400 → 형식 안내 토스트", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "대금청구 세트 저장" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("이메일 형식을 확인하세요."));
  });
});
```

실행: `npm test -- tests/app/admin/mail-recipients.test.tsx` → **FAIL**(컴포넌트 없음).

### 2. 페이지(서버 게이트)

`src/app/(app)/admin/settings/mail-recipients/page.tsx` 생성:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canManageMailRecipients } from "@/modules/workflows/services/mail-recipients";
import { PageSection } from "@/components/ui/page-section";
import { MailRecipients } from "./mail-recipients";

export default async function MailRecipientsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // D6 교집합 — 관리 API와 동일 키(접근제어 규칙①). 불충족이면 설정 목록으로.
  if (!(await canManageMailRecipients(session.user.id))) redirect("/admin/settings");
  return (
    <PageSection title="메일 수신자" subtitle="주소록과 업무유형×발송단계별 기본 수신자 세트를 관리합니다.">
      <MailRecipients />
    </PageSection>
  );
}
```

### 3. 클라 컴포넌트

`src/app/(app)/admin/settings/mail-recipients/mail-recipients.tsx` 생성:

```tsx
"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { KIND_LABEL } from "@/app/(app)/workflows/labels";

interface ContactDto { id: string; email: string; name: string; memo: string | null }
interface FieldsDto { to: string[]; cc: string[]; bcc: string[] }
interface SetDto { kind: string; steps: string[]; recipients: Record<string, FieldsDto> }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}
const parseEmails = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);

export function MailRecipients() {
  const contacts = useQuery({ queryKey: ["mail-contacts"], queryFn: () => getJson<{ contacts: ContactDto[] }>("/api/workflows/mail/contacts") });
  const sets = useQuery({ queryKey: ["mail-recipient-sets"], queryFn: () => getJson<{ sets: SetDto[] }>("/api/workflows/mail/recipients") });
  if (contacts.isLoading || sets.isLoading) return <LoadingState />;
  if (contacts.isError || sets.isError) return <ErrorState message="메일 수신자 설정을 불러오지 못했습니다." />;
  const contactList = contacts.data?.contacts ?? [];
  const nameByEmail = new Map(contactList.map((c) => [c.email, c.name]));
  return (
    <div className="space-y-8">
      <ContactsSection contacts={contactList} />
      <div className="space-y-6">
        {(sets.data?.sets ?? []).map((s) => <RecipientSetCard key={s.kind} set={s} nameByEmail={nameByEmail} />)}
      </div>
    </div>
  );
}

function ContactsSection({ contacts }: { contacts: ContactDto[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function add() {
    if (!email.trim() || !name.trim()) { toast.error("이메일과 이름을 입력하세요."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/workflows/mail/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), ...(memo.trim() ? { memo: memo.trim() } : {}) }),
      });
      if (!res.ok) {
        toast.error(res.status === 409 ? "이미 등록된 이메일입니다." : res.status === 400 ? "이메일 형식을 확인하세요." : "추가에 실패했습니다.");
        return;
      }
      toast.success("추가되었습니다.");
      setEmail(""); setName(""); setMemo("");
      await qc.invalidateQueries({ queryKey: ["mail-contacts"] });
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/workflows/mail/contacts/${id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("삭제에 실패했습니다."); return; }
      // 세트에 남은 email은 계속 유효(D12) — 주소록은 식별 보조라 별도 정리 없음.
      toast.success("삭제되었습니다.");
      await qc.invalidateQueries({ queryKey: ["mail-contacts"] });
    } finally { setBusy(false); setConfirmingId(null); }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">주소록</h2>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">등록된 주소가 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead><TableHead>이름</TableHead><TableHead>메모</TableHead><TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono">{c.email}</TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.memo ?? ""}</TableCell>
                <TableCell>
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(c)}>수정</Button>
                    {confirmingId === c.id ? (
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => remove(c.id)}>삭제 확인</Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmingId(c.id)}>삭제</Button>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">이메일</span>
          <Input aria-label="추가 이메일" value={email} placeholder="name@example.com" className="w-56" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">이름</span>
          <Input aria-label="추가 이름" value={name} placeholder="홍길동 (고객사 A 회계)" className="w-56" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">메모</span>
          <Input aria-label="추가 메모" value={memo} className="w-56" onChange={(e) => setMemo(e.target.value)} />
        </label>
        <Button size="sm" variant="secondary" disabled={busy} onClick={add}>추가</Button>
      </div>
      {editing && <EditContactModal contact={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function EditContactModal({ contact, onClose }: { contact: ContactDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(contact.name);
  const [memo, setMemo] = useState(contact.memo ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error("이름을 입력하세요."); return; }
    setBusy(true);
    try {
      // D15: email 불변 — body에 name·memo만(서버 strictObject가 email 포함을 400으로 거부).
      const res = await fetch(`/api/workflows/mail/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), ...(memo.trim() ? { memo: memo.trim() } : {}) }),
      });
      if (!res.ok) { toast.error("저장에 실패했습니다."); return; }
      toast.success("저장되었습니다.");
      await qc.invalidateQueries({ queryKey: ["mail-contacts"] });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <Modal title="주소록 수정" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm">
          <span className="text-muted-foreground">이메일 (변경 불가 — 주소 변경은 새로 등록 후 세트에서 교체)</span>{" "}
          <span className="font-mono">{contact.email}</span>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">이름</span>
          <Input aria-label="이름" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">메모</span>
          <Input aria-label="메모" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>취소</Button>
          <Button disabled={busy} onClick={save}>{busy ? "저장 중…" : "저장"}</Button>
        </div>
      </div>
    </Modal>
  );
}

const FIELD_LABEL: Record<keyof FieldsDto, string> = { to: "수신자", cc: "참조", bcc: "숨은참조" };

function RecipientSetCard({ set, nameByEmail }: { set: SetDto; nameByEmail: Map<string, string> }) {
  const qc = useQueryClient();
  const kindLabel = KIND_LABEL[set.kind] ?? set.kind;
  const [draft, setDraft] = useState<Record<string, Record<keyof FieldsDto, string>>>(() =>
    Object.fromEntries(set.steps.map((s) => {
      const f = set.recipients[s] ?? { to: [], cc: [], bcc: [] };
      return [s, { to: f.to.join(", "), cc: f.cc.join(", "), bcc: f.bcc.join(", ") }];
    })),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const payload: Record<string, FieldsDto> = {};
    for (const s of set.steps) {
      payload[s] = { to: parseEmails(draft[s].to), cc: parseEmails(draft[s].cc), bcc: parseEmails(draft[s].bcc) };
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/mail/recipients/${set.kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { toast.error(res.status === 400 ? "이메일 형식을 확인하세요." : "저장에 실패했습니다."); return; }
      toast.success("저장되었습니다.");
      await qc.invalidateQueries({ queryKey: ["mail-recipient-sets"] });
    } finally { setSaving(false); }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">{kindLabel}</h2>
      {set.steps.map((s) => (
        <div key={s} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{s}단계</h3>
          {(Object.keys(FIELD_LABEL) as Array<keyof FieldsDto>).map((field) => (
            <div key={field} className="grid gap-1">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{FIELD_LABEL[field]} (쉼표 구분)</span>
                <Input
                  aria-label={`${s}단계 ${FIELD_LABEL[field]}`}
                  value={draft[s][field]}
                  onChange={(e) => setDraft((d) => ({ ...d, [s]: { ...d[s], [field]: e.target.value } }))}
                />
              </label>
              <EmailChips text={draft[s][field]} nameByEmail={nameByEmail} />
            </div>
          ))}
        </div>
      ))}
      <div className="flex justify-end">
        <Button size="sm" disabled={saving} onClick={save}>{saving ? "저장 중…" : `${kindLabel} 세트 저장`}</Button>
      </div>
    </section>
  );
}

// D12: 주소록 미등록 email도 유효 — 배지로 식별 상태만 표시.
function EmailChips({ text, nameByEmail }: { text: string; nameByEmail: Map<string, string> }) {
  const emails = parseEmails(text);
  if (emails.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {emails.map((e, i) => {
        const name = nameByEmail.get(e.toLowerCase());
        return (
          <span key={`${e}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs">
            <span className="font-mono">{e}</span>
            {name ? <Badge variant="secondary">{name}</Badge> : <Badge variant="outline">주소록 미등록</Badge>}
          </span>
        );
      })}
    </div>
  );
}
```

실행: `npm test -- tests/app/admin/mail-recipients.test.tsx` → **PASS**.

### 4. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/app/admin && npm run build
```

`npm run build`로 페이지 컴파일(App Router 경로·서버 게이트 import) 확인. 전부 green이면 위 Files만 stage해 커밋.

## Acceptance Criteria
- `npm run typecheck` / `npm run lint` / `npm run build` → 통과.
- `npm test -- tests/app/admin/mail-recipients.test.tsx` → 통과(렌더 2 + CRUD 4 + 세트 2).
- 페이지 게이트: `canManageMailRecipients` 단일 헬퍼(API와 동일 키). 비권한 redirect `/admin/settings`.
- 수정 모달에 email 입력 없음(표시 전용). PUT payload는 응답 steps 전체를 포함한 전체 맵.
