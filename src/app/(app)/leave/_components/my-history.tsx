"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TYPE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  getFullLeaveText,
  type LeaveStatus,
} from "@/modules/leave/labels";

interface Req {
  id: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: string;
  endDate: string;
  days: string;
  status: LeaveStatus;
  reason: string | null;
  createdByAdminId: string | null;
  modifiedByAdminId: string | null;
  adminActionNote: string | null;
}

const TABS: { key: string; label: string; status?: LeaveStatus }[] = [
  { key: "ALL", label: "전체" },
  { key: "PENDING", label: "대기중", status: "PENDING" },
  { key: "APPROVED", label: "승인됨", status: "APPROVED" },
  { key: "REJECTED", label: "반려됨", status: "REJECTED" },
  { key: "CANCELLED", label: "취소됨", status: "CANCELLED" },
];

async function fetchMine(status?: LeaveStatus): Promise<Req[]> {
  const res = await fetch(
    `/api/leave/requests${status ? `?status=${status}` : ""}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`requests ${res.status}`);
  return (await res.json()).items as Req[];
}

export function MyHistory() {
  const [tab, setTab] = useState("ALL");
  const cur = TABS.find((t) => t.key === tab);
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["leave", "history", tab],
    queryFn: () => fetchMine(cur?.status),
  });
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full px-3 py-1 text-sm",
              tab === t.key
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">불러오지 못했습니다.</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">내역이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
              <span>{getFullLeaveText(r.leaveType, r.leaveSubType, r.quarterStartTime)}</span>
              <span className="text-muted-foreground">
                {fmt(r.startDate)}
                {r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}
              </span>
              <span className="tabular-nums text-muted-foreground">{Number(r.days)}일</span>
              {r.createdByAdminId && <Badge variant="secondary">관리자 등록</Badge>}
              {r.modifiedByAdminId && <Badge variant="secondary">관리자 수정</Badge>}
              <Badge className="ml-auto" variant={STATUS_VARIANT[r.status]}>
                {STATUS_LABEL[r.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
