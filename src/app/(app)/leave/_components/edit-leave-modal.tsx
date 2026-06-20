"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "./modal";
import { LeaveFields, toLeavePayload, type LeaveFormState } from "./leave-fields";

export interface EditTarget {
  id: string;
  leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export function EditLeaveModal({
  target,
  onClose,
}: {
  target: EditTarget;
  onClose: () => void;
}) {
  const [state, setState] = useState<LeaveFormState>({
    leaveType: target.leaveType,
    leaveSubType: target.leaveSubType ?? "MORNING",
    quarterStartTime: target.quarterStartTime ?? "09:00",
    startDate: target.startDate.slice(0, 10),
    endDate: target.endDate.slice(0, 10),
    reason: target.reason ?? "",
  });
  const [adminActionNote, setNote] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  // 2단계 확인: 첫 클릭은 confirmingDelete=true로만 진입, 실제 DELETE는 '삭제 확인'에서(오클릭 방지, spec §7).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const set = <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-leave"] });
    qc.invalidateQueries({ queryKey: ["leave"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/leave/requests/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toLeavePayload(state),
          adminActionNote: adminActionNote || undefined,
        }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? `수정 실패 (${res.status})`,
        );
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const del = useMutation({
    mutationFn: async () => {
      const reason = deleteReason.trim();
      if (!reason) throw new Error("삭제 사유를 입력하세요."); // 사유 필수(되돌릴 수 없는 작업)
      const res = await fetch(`/api/admin/leave/requests/${target.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? `삭제 실패 (${res.status})`,
        );
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal title="연차 수정" onClose={onClose}>
      <div className="space-y-3">
        <LeaveFields state={state} set={set} />
        <div className="space-y-1">
          <Label>수정 사유(선택)</Label>
          <Input value={adminActionNote} onChange={(e) => setNote(e.target.value)} />
        </div>
        {(save.isError || del.isError) && (
          <p className="text-sm text-destructive">
            {((save.error || del.error) as Error)?.message}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* 삭제: 사유 필수 + 2단계 확인. 빈 사유이면 버튼 disabled(UX 보조, 서버도 400으로 강제). */}
            <Input
              className="w-40"
              placeholder="삭제 사유(필수)"
              value={deleteReason}
              onChange={(e) => {
                setDeleteReason(e.target.value);
                setConfirmingDelete(false);
              }}
            />
            {!confirmingDelete ? (
              <Button
                variant="destructive"
                disabled={!deleteReason.trim()}
                onClick={() => setConfirmingDelete(true)}
              >
                삭제
              </Button>
            ) : (
              <>
                <span className="text-sm text-destructive">되돌릴 수 없습니다.</span>
                <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  취소
                </Button>
                <Button
                  variant="destructive"
                  disabled={del.isPending || !deleteReason.trim()}
                  onClick={() => del.mutate()}
                >
                  {del.isPending ? "삭제 중…" : "삭제 확인"}
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
