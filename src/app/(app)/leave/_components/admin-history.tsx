"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
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
  user: { name: string; team?: { name: string } | null } | null;
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
        if (q && !(r.user?.name.includes(q) || (r.user?.team?.name ?? "").includes(q)))
          return false;
        return true;
      }),
    [data, year, q],
  );

  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s as LeaveStatus]}</option>)}
        </Select>
        <Input
          type="number"
          className="w-24"
          placeholder="연도"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <Input
          className="w-40"
          placeholder="이름/팀 검색"
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
        <LoadingState />
      ) : isError ? (
        <ErrorState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>팀</TableHead>
              <TableHead>유형</TableHead>
              <TableHead>기간</TableHead>
              <TableHead>상태</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.user?.name ?? r.userId}</TableCell>
                <TableCell className="text-muted-foreground">{r.user?.team?.name ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>{" "}
                  {getFullLeaveText(r.leaveType, r.leaveSubType, r.quarterStartTime)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fmt(r.startDate)}
                  {r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {edit && <EditLeaveModal target={edit} onClose={() => setEdit(null)} />}
      {creating && <CreateLeaveModal onClose={() => setCreating(false)} />}
    </div>
  );
}
