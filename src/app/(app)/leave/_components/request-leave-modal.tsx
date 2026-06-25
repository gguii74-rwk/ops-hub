"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LeaveFields, emptyLeaveForm, toLeavePayload, type LeaveFormState } from "./leave-fields";

export function RequestLeaveModal({
  onClose,
  defaultDate,
}: {
  onClose: () => void;
  defaultDate?: string;
}) {
  const [state, setState] = useState<LeaveFormState>({
    ...emptyLeaveForm,
    startDate: defaultDate ?? "",
    endDate: defaultDate ?? "",
  });
  const set = <K extends keyof LeaveFormState>(k: K, v: LeaveFormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toLeavePayload(state)),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? `신청 실패 (${res.status})`,
        );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
  });

  const single = state.leaveType !== "ANNUAL";
  return (
    <Modal title="연차 신청" onClose={onClose}>
      <div className="space-y-3">
        <LeaveFields state={state} set={set} />
        {m.isError && (
          <p className="text-sm text-destructive">{(m.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={m.isPending || !state.startDate || (!single && !state.endDate)}
            onClick={() => m.mutate()}
          >
            {m.isPending ? "신청 중…" : "신청"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
