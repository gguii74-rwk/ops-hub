"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "BILLING", scheduledAt }),
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
    <Modal title="새 대금청구 작업" onClose={guardedClose}>
      <div className="space-y-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">유형</span>
          <Input value="대금청구" readOnly disabled />
        </label>
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
          <Button disabled={m.isPending || !scheduledAt} onClick={() => m.mutate()}>
            {m.isPending ? "생성 중…" : "생성"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
