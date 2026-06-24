"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
import {
  STATUS_LABEL, STATUS_VARIANT, EMPLOYMENT_LABEL, JOB_LABEL,
  EMPLOYMENT_OPTIONS, JOB_OPTIONS, type UserStatusKey,
} from "./labels";
import { ApproveModal } from "./approve-modal";
const PAGE_SIZE = 20;

interface Row {
  id: string; email: string; name: string; status: UserStatusKey;
  employmentType: keyof typeof EMPLOYMENT_LABEL; jobFunction: keyof typeof JOB_LABEL;
  systemRole: string; teamId: string | null; teamName: string | null; roleKeys: string[];
  updatedAt: string; // 낙관락(approve mutation body로 전달 — stale-tab lost-update 차단)
}
interface ListResponse { rows: Row[]; total: number; pendingCount: number; }

const STATUS_FILTER: Array<"ALL" | UserStatusKey> = ["ALL", "PENDING", "ACTIVE", "DISABLED", "REJECTED"];

async function fetchUsers(params: URLSearchParams): Promise<ListResponse> {
  const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`users ${res.status}`);
  return res.json();
}

export function UsersList({ canCreate, canUpdate, canApprove, teams }: { canCreate: boolean; canUpdate: boolean; canApprove: boolean; teams: Array<{ id: string; name: string }> }) {
  const [status, setStatus] = useState<"ALL" | UserStatusKey>("ALL");
  const [employmentType, setEmploymentType] = useState("");
  const [jobFunction, setJobFunction] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [approveTarget, setApproveTarget] = useState<Row | null>(null);

  const params = new URLSearchParams();
  if (status !== "ALL") params.set("status", status);
  if (employmentType) params.set("employmentType", employmentType);
  if (jobFunction) params.set("jobFunction", jobFunction);
  if (q) params.set("q", q);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-users", status, employmentType, jobFunction, q, page],
    queryFn: () => fetchUsers(params),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pendingCount = data?.pendingCount ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const reset = () => setPage(1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {pendingCount > 0 ? (
          <button type="button" onClick={() => { setStatus("PENDING"); reset(); }} className="contents">
            <Badge variant="secondary">승인 대기 {pendingCount}건</Badge>
          </button>
        ) : null}
        <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value as "ALL" | UserStatusKey); reset(); }}>
          {STATUS_FILTER.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s]}</option>)}
        </Select>
        <Select className="w-auto" value={employmentType} onChange={(e) => { setEmploymentType(e.target.value); reset(); }}>
          <option value="">전체 고용형태</option>
          {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
        </Select>
        <Select className="w-auto" value={jobFunction} onChange={(e) => { setJobFunction(e.target.value); reset(); }}>
          <option value="">전체 직무</option>
          {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
        </Select>
        <Input className="w-44" placeholder="이름/이메일 검색" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        {canCreate ? (
          <Link href="/admin/users/new" className={buttonVariants({ size: "sm" }) + " ml-auto"}>+ 직접 추가</Link>
        ) : null}
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
              <TableHead>이메일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>고용형태</TableHead>
              <TableHead>직무</TableHead>
              <TableHead>역할</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.name}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge></TableCell>
                <TableCell>{EMPLOYMENT_LABEL[u.employmentType]}</TableCell>
                <TableCell>{JOB_LABEL[u.jobFunction]}</TableCell>
                <TableCell className="text-muted-foreground">{u.roleKeys.join(", ") || "-"}</TableCell>
                <TableCell className="text-right">
                  {u.status === "PENDING" && canApprove ? (
                    <Button size="sm" variant="ghost" onClick={() => setApproveTarget(u)}>승인·거절</Button>
                  ) : canUpdate ? (
                    <Link href={`/admin/users/${u.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>편집</Link>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? <TableEmpty colSpan={7}>사용자가 없습니다.</TableEmpty> : null}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>총 {total}명</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
          <span>{page} / {lastPage}</span>
          <Button size="sm" variant="outline" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>다음</Button>
        </div>
      </div>

      {approveTarget ? (
        <ApproveModal target={approveTarget} teams={teams} onClose={() => setApproveTarget(null)} onDone={() => { setApproveTarget(null); void refetch(); }} />
      ) : null}
    </div>
  );
}
