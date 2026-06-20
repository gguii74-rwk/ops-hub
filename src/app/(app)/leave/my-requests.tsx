"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL, STATUS_LABEL, STATUS_VARIANT, type LeaveStatus } from "./labels";

interface Req { id: string; leaveType: string; startDate: string; endDate: string; days: string; status: LeaveStatus; reason: string | null; }

async function fetchMine(): Promise<Req[]> {
  const res = await fetch("/api/leave/requests", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`requests ${res.status}`);
  return (await res.json()).items as Req[];
}
async function cancelReq(id: string) {
  const res = await fetch(`/api/leave/requests/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `취소 실패 (${res.status})`);
}

export function MyRequests() {
  const qc = useQueryClient();
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["leave", "requests"], queryFn: fetchMine });
  const cancel = useMutation({ mutationFn: cancelReq, onSuccess: () => qc.invalidateQueries({ queryKey: ["leave"] }) });
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (isError) return <p className="text-sm text-destructive">목록을 불러오지 못했습니다.</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">신청 내역이 없습니다.</p>;
  return (
    <>
      {cancel.isError && <p className="text-sm text-destructive mb-2">{(cancel.error as Error).message}</p>}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {data.map((r) => (
        <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
          <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
          <span>{fmt(r.startDate)}{r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}</span>
          <span className="text-muted-foreground tabular-nums">{Number(r.days)}일</span>
          <Badge className="ml-auto" variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {(r.status === "PENDING" || r.status === "APPROVED") && (
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>취소</Button>
          )}
        </li>
      ))}
      </ul>
    </>
  );
}
