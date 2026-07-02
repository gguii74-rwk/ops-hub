"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { computeBillingPeriod } from "@/modules/workflows/billing/period";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { buildSubject, buildBody, plainToHtml } from "../mail-templates";
import type { EffectiveRecipientFields, RecipientEntry } from "@/modules/workflows/recipients";

const SEND_ERROR: Record<number, string> = {
  400: "입력 형식을 확인하세요.",
  403: "발송 권한이 없습니다.",
  409: "현재 상태에서 발송할 수 없습니다(이미 발송되었거나 취소됨).",
  422: "지원하지 않는 발송 단계입니다.",
};

export function SendModal({
  taskId, step, scheduledAt, effectiveRecipients, onClose,
}: {
  taskId: string; step: 1 | 2; scheduledAt: string; effectiveRecipients?: EffectiveRecipientFields; onClose: () => void;
}) {
  const { projectYear } = computeBillingPeriod(new Date(scheduledAt));
  const cfg = useQuery({
    queryKey: ["billing-config-year", projectYear],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/billing/config/${projectYear}`, { headers: { Accept: "application/json" } });
      if (res.status === 404) return { projectName: "" }; // 설정 없으면 빈 사업명(편집 가능)
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { projectName: string };
    },
  });

  if (cfg.isLoading) {
    return <Modal title={`${step}단계 발송`} onClose={onClose}><LoadingState /></Modal>;
  }
  // 일시 장애(404 아님)는 fail-closed: 사업명·제목·본문 템플릿을 신뢰할 수 없으므로 발송 폼을 띄우지 않는다(F-A2).
  // 404는 cfg.queryFn이 { projectName: "" }로 정상 처리 → isError=false(설정 없음=편집 경로, D5 보존).
  if (cfg.isError) {
    return (
      <Modal title={`${step}단계 발송`} onClose={onClose}>
        <ErrorState message="대금청구 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요." />
      </Modal>
    );
  }
  const projectName = cfg.data?.projectName ?? "";
  return (
    // 해소된 사업명이 바뀌면(캐시된 값 → refetch 최신값) remount해 제목·본문을 재prefill — stale 사업명 발송 방지.
    <SendForm
      key={projectName}
      taskId={taskId}
      step={step}
      scheduledAt={scheduledAt}
      projectName={projectName}
      projectNameMissing={projectName.trim() === ""}
      effectiveRecipients={effectiveRecipients}
      onClose={onClose}
    />
  );
}

function SendForm({
  taskId, step, scheduledAt, projectName, projectNameMissing, effectiveRecipients, onClose,
}: {
  taskId: string; step: 1 | 2; scheduledAt: string; projectName: string; projectNameMissing: boolean;
  effectiveRecipients?: EffectiveRecipientFields; onClose: () => void;
}) {
  const qc = useQueryClient();
  const ctx = { scheduledAt: new Date(scheduledAt), projectName };
  const parseList = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
  const joinEmails = (list: RecipientEntry[] | undefined) => (list ?? []).map((e) => e.email).join(", ");
  const [recipients, setRecipients] = useState(joinEmails(effectiveRecipients?.to));
  const [cc, setCc] = useState(joinEmails(effectiveRecipients?.cc));
  const [bcc, setBcc] = useState(joinEmails(effectiveRecipients?.bcc));
  const [subject, setSubject] = useState(buildSubject(step, ctx));
  const [body, setBody] = useState(buildBody(step, ctx));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    // D6 fail-closed: 화면 표시 목록을 파싱해 빈 목록이면 발송 차단(fetch 미발생). 백엔드 폴백 미의존.
    const to = parseList(recipients);
    if (to.length === 0) { setError("수신자를 1명 이상 입력하세요."); return; }
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/workflows/${taskId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 화면 3필드를 항상 명시 포함(정확히 일치, 생략 없음 — D6). 정규화(dedup·교차 제외)는 서버 lib 소유(D10).
        body: JSON.stringify({ step, subject, body: plainToHtml(body), recipients: to, cc: parseList(cc), bcc: parseList(bcc) }),
      });
      if (!res.ok) { toast.error(SEND_ERROR[res.status] ?? "발송에 실패했습니다."); return; }
      toast.success("발송되었습니다.");
      await qc.invalidateQueries({ queryKey: ["workflow", taskId] });
      await qc.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
    } finally { setSending(false); }
  }

  const guardedClose = () => { if (!sending) onClose(); };

  return (
    <Modal title={`${step}단계 발송`} onClose={guardedClose}>
      <div className="space-y-3">
        {projectNameMissing && (
          <p className="text-sm text-amber-600">이 연도의 대금청구 설정(사업명)이 없습니다 — 제목·본문의 사업명을 직접 확인·입력하세요.</p>
        )}
        <RecipientField label="수신자" value={recipients} onChange={setRecipients} entries={effectiveRecipients?.to} />
        <RecipientField label="참조" value={cc} onChange={setCc} entries={effectiveRecipients?.cc} />
        <RecipientField label="숨은참조" value={bcc} onChange={setBcc} entries={effectiveRecipients?.bcc} />
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">제목</span>
          <Input aria-label="제목" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">본문</span>
          <Textarea aria-label="본문" rows={12} className="font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {step === 2 && <p className="text-sm text-muted-foreground">첨부 없음 — 서류 발급 요청 메일입니다.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={sending} onClick={guardedClose}>취소</Button>
          <Button disabled={sending} onClick={submit}>{sending ? "발송 중…" : "발송"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function RecipientField({ label, value, onChange, entries }: {
  label: string; value: string; onChange: (v: string) => void; entries?: RecipientEntry[];
}) {
  // 이름 힌트(D8): 서버가 enrich한 name 있는 항목만 "email = name"으로 표시.
  const hints = (entries ?? []).filter((e): e is Required<RecipientEntry> => Boolean(e.name));
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label} (쉼표 구분)</span>
      <Input aria-label={label} value={value} placeholder="name@example.com, ..." onChange={(e) => onChange(e.target.value)} />
      {hints.length > 0 && (
        <span className="text-xs text-muted-foreground">{hints.map((e) => `${e.email} = ${e.name}`).join(" · ")}</span>
      )}
    </label>
  );
}
