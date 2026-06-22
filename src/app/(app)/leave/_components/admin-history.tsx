"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TYPE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  getFullLeaveText,
  type LeaveStatus,
} from "@/modules/leave/labels";
import { EditLeaveModal, type EditTarget } from "./edit-leave-modal";
import { CreateLeaveModal } from "./create-leave-modal";

interface Row {
  id: string;
  userId: string;
  leaveType: "ANNUAL" | "HALF" | "QUARTER";
  leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null;
  startDate: string;
  endDate: string;
  days: string;
  status: LeaveStatus;
  reason: string | null;
  updatedAt: string; // 낙관락(수정 mutation body로 전달 — stale-tab lost-update 차단)
  createdByAdminId: string | null;
  modifiedByAdminId: string | null;
  user: { name: string; department: string | null } | null;
}

const STATUSES: ("ALL" | LeaveStatus)[] = ["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"];

async function fetchAll(status: string): Promise<Row[]> {
  const res = await fetch(
    `/api/admin/leave/requests${status !== "ALL" ? `?status=${status}` : ""}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`requests ${res.status}`);
  return (await res.json()).items as Row[];
}

export function AdminHistory({
  canUpdate,
  canDelete,
  canApprove,
}: {
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const [status, setStatus] = useState("ALL");
  const [year, setYear] = useState<string>("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["admin-leave", "history", status],
    queryFn: () => fetchAll(status),
  });

  const filtered = useMemo(
    () =>
      data.filter((r) => {
        if (year && new Date(r.startDate).getFullYear() !== Number(year)) return false;
        if (q && !(r.user?.name.includes(q) || (r.user?.department ?? "").includes(q)))
          return false;
        return true;
      }),
    [data, year, q],
  );

  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "전체 상태" : STATUS_LABEL[s as LeaveStatus]}
            </option>
          ))}
        </select>
        <Input
          type="number"
          className="w-24"
          placeholder="연도"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <Input
          className="w-40"
          placeholder="이름/부서 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {/* 직접입력은 leave.approval:approve 게이트 (결정 A: SC-2 API 키 일치) */}
        {canApprove && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            + 연차 직접 입력
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">불러오지 못했습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-2">이름</th>
                <th className="p-2">부서</th>
                <th className="p-2">유형</th>
                <th className="p-2">기간</th>
                <th className="p-2">상태</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2">{r.user?.name ?? r.userId}</td>
                  <td className="p-2 text-muted-foreground">{r.user?.department ?? "-"}</td>
                  <td className="p-2">
                    <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>{" "}
                    {getFullLeaveText(r.leaveType, r.leaveSubType, r.quarterStartTime)}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {fmt(r.startDate)}
                    {r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}
                  </td>
                  <td className="p-2">
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td className="p-2 text-right">
                    {/* 수정 버튼 진입은 canUpdate||canDelete 게이트; 서버가 PATCH=update, DELETE=delete 각각 가드. */}
                    {(canUpdate || canDelete) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEdit({
                            id: r.id,
                            leaveType: r.leaveType,
                            leaveSubType: r.leaveSubType,
                            quarterStartTime: r.quarterStartTime,
                            startDate: r.startDate,
                            endDate: r.endDate,
                            reason: r.reason,
                            updatedAt: r.updatedAt,
                          })
                        }
                      >
                        수정·삭제
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EditLeaveModal target={edit} onClose={() => setEdit(null)} />}
      {creating && <CreateLeaveModal onClose={() => setCreating(false)} />}
    </div>
  );
}
