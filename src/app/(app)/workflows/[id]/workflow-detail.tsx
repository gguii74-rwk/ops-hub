"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KIND_RESOURCE, isDownloadableStatus } from "@/modules/workflows/policy";
import { useCan } from "@/lib/auth/permissions-client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SendModal } from "./send-modal";
import {
  CANCELLABLE, KIND_LABEL, MAIL_LABEL, MAIL_VARIANT, STATUS_LABEL, STATUS_VARIANT,
  type MailStatus, type WfStatus,
} from "../labels";
import type { EffectiveRecipientsMap } from "@/modules/workflows/recipients";

interface TimelineEntry { id: string; fromStatus: WfStatus | null; toStatus: WfStatus; actorId: string | null; note: string | null; occurredAt: string; }
interface MailView { id: string; step: string | null; recipients: string[]; cc: string[]; bcc?: string[]; subject: string; status: MailStatus; errorMessage: string | null; sentAt: string | null; }
interface FileView { id: string; displayName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; }
interface Detail {
  id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: EffectiveRecipientsMap; // :send 권한자에게만 백엔드가 포함(D8 — 단계별 맵)
}

async function fetchDetail(id: string): Promise<Detail | null> {
  const res = await fetch(`/api/workflows/${id}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`detail ${res.status}`);
  return res.json() as Promise<Detail>;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

export function WorkflowDetail({ taskId, isAdmin }: { taskId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [sendStep, setSendStep] = useState<1 | 2 | null>(null);
  const query = useQuery({ queryKey: ["workflow", taskId], queryFn: () => fetchDetail(taskId) });
  const detail = query.data;
  // useCan은 무조건 호출(훅 규칙) — detail 전엔 임의 리소스로 false.
  const resource = detail ? (KIND_RESOURCE as Record<string, string>)[detail.kind] ?? "workflows.weekly" : "workflows.weekly";
  const canSend = useCan(resource, "send");
  const canGenerate = useCan(resource, "generate");

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        alert(`작업 실패 (${res.status})`);
      }
      await qc.invalidateQueries({ queryKey: ["workflow", taskId] });
      await qc.invalidateQueries({ queryKey: ["workflows"] });
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (query.isError) return <p className="text-sm text-destructive">상세를 불러오지 못했습니다.</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">작업을 찾을 수 없습니다.</p>;

  const cancellable = CANCELLABLE.includes(detail.status);
  const isBilling = detail.kind === "BILLING";
  const hasFiles = detail.files.length > 0;
  // 다운로드 링크 노출 = 서버 다운로드 게이트와 동일 불변식(policy.isDownloadableStatus) 공유 — 서버↔UI 분기 방지.
  const downloadable = isBilling && hasFiles && isDownloadableStatus(detail.status);

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/workflows" className="text-sm text-muted-foreground hover:underline">← 목록</Link>
        <Badge variant="outline">{KIND_LABEL[detail.kind] ?? detail.kind}</Badge>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{detail.typeName}</h1>
        <Badge variant={STATUS_VARIANT[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
        <span className="text-sm text-muted-foreground">{new Date(detail.scheduledAt).toLocaleDateString("ko-KR")}</span>
        {cancellable && (
          <Button className="ml-auto" size="sm" variant="destructive" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/cancel`)}>
            취소
          </Button>
        )}
      </div>

      {/* 액션 슬롯 — BILLING 한정 상태머신(§SC-10, 재생성 없음 D10). 타 kind는 빈 슬롯(별도 sub-project). */}
      {isBilling && (
        <div className="flex flex-wrap items-center gap-2">
          {detail.status === "PENDING" && canGenerate && (
            <Button size="sm" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/generate`)}>문서 생성</Button>
          )}
          {downloadable && (
            <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/workflows/${taskId}/download`}>
              전체 다운로드(ZIP)
            </a>
          )}
          {detail.status === "GENERATED" && canSend && (
            <Button size="sm" disabled={busy} onClick={() => setSendStep(1)}>1단계 발송</Button>
          )}
          {detail.status === "SENT" && canSend && (
            <Button size="sm" disabled={busy} onClick={() => setSendStep(2)}>2단계 발송</Button>
          )}
          {detail.status === "HQ_REQUESTED" && (
            <span className="text-sm text-muted-foreground">최종발송(3단계)은 후속 단계에서 지원합니다.</span>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">진행 이력</h2>
        <ol className="space-y-1 border-l border-border pl-4">
          {detail.timeline.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium">{e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}{STATUS_LABEL[e.toStatus]}</span>
              <span className="text-muted-foreground"> · {fmt(e.occurredAt)}{e.actorId ? ` · ${e.actorId}` : ""}</span>
              {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
            </li>
          ))}
        </ol>
      </div>

      {hasFiles && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">생성 파일</h2>
          <ul className="space-y-1">
            {detail.files.map((f) => (
              <li key={f.id} className="text-sm">
                {downloadable ? (
                  <a className="text-primary underline-offset-4 hover:underline" href={`/api/workflows/${taskId}/files/${f.id}`}>
                    {f.displayName}
                  </a>
                ) : (
                  f.displayName
                )}
                {f.sizeBytes != null && <span className="text-muted-foreground"> · {Math.round(f.sizeBytes / 1024)} KB</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">메일 발송</h2>
        {detail.mailDeliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">발송 이력 없음</p>
        ) : (
          <ul className="space-y-2">
            {detail.mailDeliveries.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <Badge variant={MAIL_VARIANT[m.status]}>{MAIL_LABEL[m.status]}</Badge>
                <span className="font-medium">{m.subject}</span>
                <span className="text-muted-foreground">{m.recipients.join(", ")}</span>
                {m.cc.length > 0 && <span className="text-muted-foreground">참조: {m.cc.join(", ")}</span>}
                {m.bcc && m.bcc.length > 0 && <span className="text-muted-foreground">숨은참조: {m.bcc.join(", ")}</span>}
                {m.errorMessage && <span className="text-destructive">{m.errorMessage}</span>}
                {m.status === "FAILED" && canSend && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/mail/${m.id}/retry`)}>
                    재시도
                  </Button>
                )}
                {m.status === "SENDING" && isAdmin && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/mail/${m.id}/resolve`, { to: "SENT" })}>발송됨 확정</Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => act(`/api/workflows/${taskId}/mail/${m.id}/resolve`, { to: "FAILED" })}>실패 확정</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {sendStep != null && (
        <SendModal
          taskId={taskId}
          step={sendStep}
          scheduledAt={detail.scheduledAt}
          effectiveRecipients={detail.effectiveRecipients?.[String(sendStep)]}
          onClose={() => setSendStep(null)}
        />
      )}
    </section>
  );
}
