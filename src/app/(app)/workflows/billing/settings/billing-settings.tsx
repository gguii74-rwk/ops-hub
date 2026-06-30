"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { validateConfigForm, formToConfigPayload, emptyConfigForm, type ConfigForm } from "./config-form";
import { dateInputToSubmitDateIso, submitDateIsoToDateInput } from "./round-date";

interface ConfigDto {
  id: string; year: number; projectName: string; contractNumber: string;
  contractAmount: number; monthlyAmount: number; contractAmountKor: string; monthlyAmountKor: string;
  createdAt: string; updatedAt: string;
}
interface RoundDto { round: number; submitDate: string }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

export function BillingSettings({ canConfigure }: { canConfigure: boolean }) {
  const list = useQuery({ queryKey: ["billing-config"], queryFn: () => getJson<ConfigDto[]>("/api/workflows/billing/config") });
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [newYear, setNewYear] = useState("");

  if (list.isLoading) return <LoadingState />;
  if (list.isError) return <ErrorState message="설정을 불러오지 못했습니다." />;

  const configs = list.data ?? [];
  const years = configs.map((c) => c.year);
  const selectedConfig = configs.find((c) => c.year === selectedYear) ?? null;

  function addYear() {
    const y = Number(newYear);
    if (!Number.isInteger(y) || y < 2020 || y > 2100) { toast.error("연도는 2020~2100 정수입니다."); return; }
    if (years.includes(y)) { toast.error("이미 존재하는 연도입니다."); return; }
    setSelectedYear(y);
    setNewYear("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">연도</span>
          <Select
            aria-label="연도 선택"
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
            className="w-40"
          >
            <option value="">연도 선택</option>
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </Select>
        </label>
        {canConfigure && (
          <div className="flex items-end gap-1">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">새 연도</span>
              <Input type="number" aria-label="새 연도" value={newYear} placeholder="2026" className="w-28" onChange={(e) => setNewYear(e.target.value)} />
            </label>
            <Button size="sm" variant="secondary" onClick={addYear}>추가</Button>
          </div>
        )}
      </div>

      {selectedYear != null && (
        <>
          <ConfigForm key={selectedYear} year={selectedYear} config={selectedConfig} canConfigure={canConfigure} onDeleted={() => setSelectedYear(null)} />
          {/* 회차표는 config가 저장된 연도에만 노출 — config 없는 연도에 회차일을 저장하면 FK 없는 orphan 회차일이 되어 추후 생성에 소리없이 반영됨. */}
          {selectedConfig != null && <RoundsTable year={selectedYear} canConfigure={canConfigure} />}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}

function ConfigForm({ year, config, canConfigure, onDeleted }: { year: number; config: ConfigDto | null; canConfigure: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigForm>(
    config
      ? {
          year, projectName: config.projectName, contractNumber: config.contractNumber,
          contractAmount: String(config.contractAmount), monthlyAmount: String(config.monthlyAmount),
          contractAmountKor: config.contractAmountKor, monthlyAmountKor: config.monthlyAmountKor,
        }
      : { ...emptyConfigForm, year },
  );
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const exists = config != null;
  const set = (k: keyof ConfigForm, v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function save() {
    const err = validateConfigForm(form);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const res = await fetch(exists ? `/api/workflows/billing/config/${year}` : "/api/workflows/billing/config", {
        method: exists ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToConfigPayload(form)),
      });
      if (!res.ok) { toast.error(res.status === 409 ? "이미 존재하는 연도입니다." : "저장에 실패했습니다."); return; }
      toast.success("저장되었습니다.");
      await qc.invalidateQueries({ queryKey: ["billing-config"] });
    } finally { setSaving(false); }
  }

  async function remove() {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/billing/config/${year}`, { method: "DELETE" });
      if (!res.ok) { toast.error("삭제에 실패했습니다."); return; }
      toast.success("삭제되었습니다.");
      // 선택 해제(F-B1): ConfigForm은 key=selectedYear로 계속 mounted라 useState 초기값이 재적용되지 않는다.
      // 그대로 두면 form이 삭제 전 계약값을 유지(exists만 false) → 사용자가 저장을 누르면 방금 삭제한 연도를
      // stale 값으로 POST 재생성한다. 부모가 selectedYear=null로 폼을 unmount → 다음 선택/생성 시 깨끗한 상태.
      onDeleted();
      await qc.invalidateQueries({ queryKey: ["billing-config"] });
    } finally { setSaving(false); setConfirmingDelete(false); }
  }

  return (
    <section className="grid gap-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{year}년 계약 정보</h2>
      <Field label="사업명"><Input value={form.projectName} disabled={!canConfigure} onChange={(e) => set("projectName", e.target.value)} /></Field>
      <Field label="계약번호"><Input value={form.contractNumber} disabled={!canConfigure} onChange={(e) => set("contractNumber", e.target.value)} /></Field>
      <Field label="총 계약금액(원)"><Input type="number" value={form.contractAmount} disabled={!canConfigure} onChange={(e) => set("contractAmount", e.target.value)} /></Field>
      <Field label="총 계약금액(한글)"><Input value={form.contractAmountKor} disabled={!canConfigure} onChange={(e) => set("contractAmountKor", e.target.value)} /></Field>
      <Field label="월 청구액(원)"><Input type="number" value={form.monthlyAmount} disabled={!canConfigure} onChange={(e) => set("monthlyAmount", e.target.value)} /></Field>
      <Field label="월 청구액(한글)"><Input value={form.monthlyAmountKor} disabled={!canConfigure} onChange={(e) => set("monthlyAmountKor", e.target.value)} /></Field>
      {canConfigure && (
        <div className="grid gap-2">
          <div className="flex gap-2">
            <Button size="sm" aria-label="계약 정보 저장" disabled={saving} onClick={save}>{saving ? "저장 중…" : "저장"}</Button>
            {exists && !confirmingDelete && (
              <Button size="sm" variant="destructive" aria-label="계약 정보 삭제" disabled={saving} onClick={() => setConfirmingDelete(true)}>삭제</Button>
            )}
          </div>
          {exists && confirmingDelete && (
            // 파괴적 삭제(연도 설정 + 회차 제출일 연쇄 삭제, SC-1)는 확인 후에만 실행(F-A3).
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <span>{year}년 계약 정보와 등록된 회차 제출일이 모두 삭제됩니다. 계속하시겠습니까?</span>
              <Button size="sm" variant="destructive" aria-label="삭제 확정" disabled={saving} onClick={remove}>삭제 확정</Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setConfirmingDelete(false)}>취소</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RoundsTable({ year, canConfigure }: { year: number; canConfigure: boolean }) {
  const qc = useQueryClient();
  const rounds = useQuery({ queryKey: ["billing-rounds", year], queryFn: () => getJson<RoundDto[]>(`/api/workflows/billing/config/${year}/rounds`) });
  const [busy, setBusy] = useState<number | null>(null);

  async function saveRound(round: number, dateStr: string) {
    if (!dateStr) { toast.error("제출일을 입력하세요."); return; }
    setBusy(round);
    try {
      const res = await fetch(`/api/workflows/billing/config/${year}/rounds/${round}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submitDate: dateInputToSubmitDateIso(dateStr) }),
      });
      if (!res.ok) { toast.error("회차 저장에 실패했습니다."); return; }
      toast.success(`${round}회차 저장`);
      await qc.invalidateQueries({ queryKey: ["billing-rounds", year] });
    } finally { setBusy(null); }
  }
  async function deleteRound(round: number) {
    setBusy(round);
    try {
      const res = await fetch(`/api/workflows/billing/config/${year}/rounds/${round}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) { toast.error("회차 삭제에 실패했습니다."); return; }
      toast.success(`${round}회차 삭제`);
      await qc.invalidateQueries({ queryKey: ["billing-rounds", year] });
    } finally { setBusy(null); }
  }

  if (rounds.isLoading) return <LoadingState />;
  if (rounds.isError) return <ErrorState message="회차 제출일을 불러오지 못했습니다." />;
  const byRound = new Map((rounds.data ?? []).map((r) => [r.round, r.submitDate]));

  return (
    <section className="grid gap-2">
      <h2 className="font-medium">회차 제출일</h2>
      <Table>
        <TableHeader>
          <TableRow><TableHead>회차</TableHead><TableHead>월분</TableHead><TableHead>제출일</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((round) => {
            const initial = byRound.get(round) ?? null;
            return (
              <RoundRow
                key={`${round}-${initial ?? ""}`}
                round={round}
                initial={initial}
                canConfigure={canConfigure}
                busy={busy === round}
                onSave={(d) => saveRound(round, d)}
                onDelete={() => deleteRound(round)}
              />
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function RoundRow({
  round, initial, canConfigure, busy, onSave, onDelete,
}: {
  round: number; initial: string | null; canConfigure: boolean; busy: boolean;
  onSave: (d: string) => void; onDelete: () => void;
}) {
  const [date, setDate] = useState(initial ? submitDateIsoToDateInput(initial) : "");
  return (
    <TableRow>
      <TableCell>{round}회차</TableCell>
      <TableCell>{round}월분</TableCell>
      <TableCell>
        <Input type="date" aria-label={`${round}회차 제출일`} value={date} disabled={!canConfigure} className="w-40" onChange={(e) => setDate(e.target.value)} />
      </TableCell>
      <TableCell>
        {canConfigure && (
          <span className="flex gap-1">
            <Button size="sm" variant="outline" aria-label={`${round}회차 저장`} disabled={busy} onClick={() => onSave(date)}>저장</Button>
            {initial && <Button size="sm" variant="ghost" aria-label={`${round}회차 삭제`} disabled={busy} onClick={onDelete}>삭제</Button>}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
