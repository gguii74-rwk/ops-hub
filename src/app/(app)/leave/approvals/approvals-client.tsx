"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL } from "@/app/(app)/leave/labels";

interface Req {
  id: string;
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  user?: { name: string };
}

async function fetchPending(): Promise<Req[]> {
  const res = await fetch("/api/admin/leave/approvals", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`pending ${res.status}`);
  return (await res.json()).items as Req[];
}

async function act(id: string, kind: "approve" | "reject", rejectionReason?: string) {
  const res = await fetch(`/api/admin/leave/requests/${id}/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: kind === "reject" ? JSON.stringify({ rejectionReason }) : "{}",
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${kind} 실패 (${res.status})`);
}

export function ApprovalsClient() {
  const qc = useQueryClient();
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["admin-leave", "pending"], queryFn: fetchPending });
  const m = useMutation({
    mutationFn: (v: { id: string; kind: "approve" | "reject" }) =>
      act(v.id, v.kind, v.kind === "reject" ? "반려" : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-leave"] }),
  });
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (isError) return <p className="text-sm text-destructive">목록을 불러오지 못했습니다.</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">대기 중인 신청이 없습니다.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {data.map((r) => (
        <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
          <span className="font-medium">{r.user?.name ?? r.userId}</span>
          <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
          <span>
            {fmt(r.startDate)}
            {r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}
          </span>
          <span className="text-muted-foreground tabular-nums">{Number(r.days)}일</span>
          <div className="ml-auto flex gap-1">
            <Button size="sm" disabled={m.isPending} onClick={() => m.mutate({ id: r.id, kind: "approve" })}>
              승인
            </Button>
            <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate({ id: r.id, kind: "reject" })}>
              반려
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
