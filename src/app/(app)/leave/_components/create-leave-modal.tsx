"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "./modal";
import { UserSelect } from "./user-select";
import { LeaveFields, emptyLeaveForm, toLeavePayload, type LeaveFormState } from "./leave-fields";

export function CreateLeaveModal({
  onClose,
  defaultDate,
}: {
  onClose: () => void;
  defaultDate?: string;
}) {
  const [userId, setUserId] = useState("");
  const [sendNotification, setSendNotification] = useState(false);
  const [state, setState] = useState<LeaveFormState>({
    ...emptyLeaveForm,
    startDate: defaultDate ?? "",
  });
  const set = <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, sendNotification, ...toLeavePayload(state) }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? `등록 실패 (${res.status})`,
        );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-leave"] });
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
  });

  const single = state.leaveType !== "ANNUAL";
  return (
    <Modal title="연차 직접 입력" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>사용자</Label>
          <UserSelect value={userId} onChange={setUserId} />
        </div>
        <LeaveFields state={state} set={set} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendNotification}
            onChange={(e) => setSendNotification(e.target.checked)}
          />
          사용자에게 이메일 알림 발송
        </label>
        {m.isError && (
          <p className="text-sm text-destructive">{(m.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={
              m.isPending ||
              !userId ||
              !state.startDate ||
              (!single && !state.endDate)
            }
            onClick={() => m.mutate()}
          >
            {m.isPending ? "등록 중…" : "등록"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
