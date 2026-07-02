"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WorkflowKind } from "@prisma/client";
import { useCan } from "@/lib/auth/permissions-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { KIND_LABEL, WORKFLOW_KIND_ORDER } from "./labels";

export function CreateTaskModal({ defaultDate, onClose }: { defaultDate?: string; onClose: () => void }) {
  const router = useRouter();
  // useCan은 고정 개수로 호출(react-hooks 규칙). 완전매핑 Record라 kind 추가 시 typecheck가 강제.
  const canCreate: Record<WorkflowKind, boolean> = {
    BILLING: useCan("workflows.billing", "create"),
    NOTIFICATION_BILLING: useCan("workflows.notification", "create"),
    WEEKLY_REPORT: useCan("workflows.weekly", "create"),
    WEEKLY_REPORT_CLIENT: useCan("workflows.weeklyClient", "create"),
    MONTHLY_REPORT_CLIENT: useCan("workflows.monthlyClient", "create"),
  };
  const options = WORKFLOW_KIND_ORDER.filter((k) => canCreate[k]);

  const [kind, setKind] = useState<WorkflowKind | "">(options[0] ?? "");
  const [scheduledAt, setScheduledAt] = useState(defaultDate ?? "");

  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, scheduledAt }),
      });
      if (!res.ok) {
        throw new Error(res.status === 403 ? "작업 생성 권한이 없습니다." : `생성 실패 (${res.status})`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (data) => { onClose(); router.push(`/workflows/${data.id}`); },
    onError: (e) => { toast.error((e as Error).message); },
  });
  // 제출 중 닫기 차단(in-flight 결과 보존 — 기존 모달 관례).
  const guardedClose = () => { if (!m.isPending) onClose(); };

  return (
    <Modal title="새 작업 등록" onClose={guardedClose}>
      <div className="space-y-3">
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">작업을 생성할 권한이 있는 유형이 없습니다.</p>
        ) : (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">유형</span>
            <Select
              aria-label="유형"
              value={kind}
              onChange={(e) => setKind(e.target.value as WorkflowKind)}
            >
              {options.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </label>
        )}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">예정일</span>
          <Input
            aria-label="예정일"
            type="date"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={m.isPending} onClick={guardedClose}>취소</Button>
          <Button disabled={m.isPending || !scheduledAt || !kind} onClick={() => m.mutate()}>
            {m.isPending ? "생성 중…" : "생성"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
