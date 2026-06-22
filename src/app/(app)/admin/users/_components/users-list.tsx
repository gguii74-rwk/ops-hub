"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import {
  STATUS_LABEL, STATUS_VARIANT, EMPLOYMENT_LABEL, JOB_LABEL,
  EMPLOYMENT_OPTIONS, JOB_OPTIONS, type UserStatusKey,
} from "./labels";
import { ApproveModal } from "./approve-modal";

const selectCls = "h-8 rounded-lg border border-input bg-background px-2.5 text-sm";
const PAGE_SIZE = 20;

interface Row {
  id: string; email: string; name: string; status: UserStatusKey;
  employmentType: keyof typeof EMPLOYMENT_LABEL; jobFunction: keyof typeof JOB_LABEL;
  systemRole: string; department: string | null; roleKeys: string[];
  updatedAt: string; // 낙관락(approve mutation body로 전달 — stale-tab lost-update 차단)
}
interface ListResponse { rows: Row[]; total: number; pendingCount: number; }

const STATUS_FILTER: Array<"ALL" | UserStatusKey> = ["ALL", "PENDING", "ACTIVE", "DISABLED", "REJECTED"];

async function fetchUsers(params: URLSearchParams): Promise<ListResponse> {
  const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`users ${res.status}`);
  return res.json();
}

export function UsersList({ canCreate, canUpdate, canApprove }: { canCreate: boolean; canUpdate: boolean; canApprove: boolean }) {
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
        <select className={selectCls} value={status} onChange={(e) => { setStatus(e.target.value as "ALL" | UserStatusKey); reset(); }}>
          {STATUS_FILTER.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s]}</option>)}
        </select>
        <select className={selectCls} value={employmentType} onChange={(e) => { setEmploymentType(e.target.value); reset(); }}>
          <option value="">전체 고용형태</option>
          {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
        </select>
        <select className={selectCls} value={jobFunction} onChange={(e) => { setJobFunction(e.target.value); reset(); }}>
          <option value="">전체 직무</option>
          {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
        </select>
        <Input className="w-44" placeholder="이름/이메일 검색" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        {canCreate ? (
          <Link href="/admin/users/new" className={buttonVariants({ size: "sm" }) + " ml-auto"}>+ 직접 추가</Link>
        ) : null}
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
                <th className="p-2">이메일</th>
                <th className="p-2">상태</th>
                <th className="p-2">고용형태</th>
                <th className="p-2">직무</th>
                <th className="p-2">역할</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="p-2">{u.name}</td>
                  <td className="p-2 text-muted-foreground">{u.email}</td>
                  <td className="p-2"><Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge></td>
                  <td className="p-2">{EMPLOYMENT_LABEL[u.employmentType]}</td>
                  <td className="p-2">{JOB_LABEL[u.jobFunction]}</td>
                  <td className="p-2 text-muted-foreground">{u.roleKeys.join(", ") || "-"}</td>
                  <td className="p-2 text-right">
                    {u.status === "PENDING" && canApprove ? (
                      <Button size="sm" variant="ghost" onClick={() => setApproveTarget(u)}>승인·거절</Button>
                    ) : canUpdate ? (
                      <Link href={`/admin/users/${u.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>편집</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">사용자가 없습니다.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
        <ApproveModal target={approveTarget} onClose={() => setApproveTarget(null)} onDone={() => { setApproveTarget(null); void refetch(); }} />
      ) : null}
    </div>
  );
}
