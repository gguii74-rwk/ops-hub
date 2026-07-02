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
        {/* 라벨 시각 텍스트를 aria-label과 동일하게 맞춤 — 다르면 testing-library의 wrapper-label 매칭이
            수정 모달의 "이메일"/"이름" 쿼리와 충돌해 이 입력이 잘못 매칭된다(같은 문서에 동시 렌더). */}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">추가 이메일</span>
          <Input aria-label="추가 이메일" value={email} placeholder="name@example.com" className="w-56" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">추가 이름</span>
          <Input aria-label="추가 이름" value={name} placeholder="홍길동 (고객사 A 회계)" className="w-56" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">추가 메모</span>
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
      // 서버가 trim/lowercase/dedupe한 값을 echo(§4.3) — 화면 draft를 그 값으로 동기화해
      // 저장 직후 입력에 남은 raw 값(대소문자·공백·중복)이 저장된 값과 갈라지지 않게 한다.
      try {
        const data = (await res.json()) as { recipients?: Record<string, FieldsDto> };
        if (data.recipients) {
          setDraft(Object.fromEntries(set.steps.map((s) => {
            const f = data.recipients![s] ?? { to: [], cc: [], bcc: [] };
            return [s, { to: f.to.join(", "), cc: f.cc.join(", "), bcc: f.bcc.join(", ") }];
          })));
        }
      } catch {
        // 응답 본문이 없거나 파싱 실패해도 저장 자체는 성공 — draft는 기존 값 유지.
      }
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
