"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-section";
import { StatStrip, Stat } from "@/components/ui/stat-strip";
import { Toolbar, Pill } from "@/components/ui/toolbar";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
import {
  STATUS_LABEL, STATUS_TONE, EMPLOYMENT_LABEL, JOB_LABEL,
  EMPLOYMENT_TONE, JOB_TONE, EMPLOYMENT_OPTIONS, JOB_OPTIONS,
  roleLabel, roleTone, type UserStatusKey,
} from "./labels";
import { ApproveModal } from "./approve-modal";
const PAGE_SIZE = 20;

interface Row {
  id: string; email: string; name: string; status: UserStatusKey;
  employmentType: keyof typeof EMPLOYMENT_LABEL; jobFunction: keyof typeof JOB_LABEL;
  systemRole: string; teamId: string | null; teamName: string | null; roleKeys: string[];
  updatedAt: string; // 낙관락(approve mutation body로 전달 — stale-tab lost-update 차단)
}
interface ListResponse {
  rows: Row[]; total: number; pendingCount: number;
  stats: { total: number; active: number; contractor: number };
}

// 빠른 상태 필터(pill). INVITED는 드물어 pill에서 제외(필요 시 검색·전체에서 노출).
const STATUS_PILLS: Array<{ value: "ALL" | UserStatusKey; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "PENDING", label: "대기" },
  { value: "ACTIVE", label: "활성" },
  { value: "DISABLED", label: "비활성" },
  { value: "REJECTED", label: "거절" },
];

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
  const stats = data?.stats ?? { total: 0, active: 0, contractor: 0 };
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const reset = () => setPage(1);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="구성원"
        title="사용자 관리"
        actions={canCreate ? (
          <Link href="/admin/users/new" className={buttonVariants({ size: "sm" })}>＋ 직접 추가</Link>
        ) : null}
      />

      <StatStrip>
        <Stat accent value={pendingCount} label="승인 대기" onClick={() => { setStatus("PENDING"); reset(); }} />
        <Stat value={stats.total} label="전체" />
        <Stat value={stats.active} label="활성" />
        <Stat value={stats.contractor} label="외주" />
      </StatStrip>

      <Card>
        <CardContent className="space-y-3">
          <Toolbar>
            {STATUS_PILLS.map((s) => (
              <Pill key={s.value} active={status === s.value} onClick={() => { setStatus(s.value); reset(); }}>
                {s.label}
              </Pill>
            ))}
            <Select className="w-auto" value={employmentType} onChange={(e) => { setEmploymentType(e.target.value); reset(); }}>
              <option value="">전체 고용형태</option>
              {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
            </Select>
            <Select className="w-auto" value={jobFunction} onChange={(e) => { setJobFunction(e.target.value); reset(); }}>
              <option value="">전체 직무</option>
              {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
            </Select>
            <Input className="ml-auto w-44" placeholder="이름·이메일 검색" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          </Toolbar>

          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState />
          ) : (
            <Table bordered={false}>
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
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.email}</TableCell>
                    <TableCell><Chip tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Chip></TableCell>
                    <TableCell><Chip tone={EMPLOYMENT_TONE[u.employmentType]}>{EMPLOYMENT_LABEL[u.employmentType]}</Chip></TableCell>
                    <TableCell><Chip tone={JOB_TONE[u.jobFunction]}>{JOB_LABEL[u.jobFunction]}</Chip></TableCell>
                    <TableCell>
                      {u.roleKeys.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {u.roleKeys.map((k) => <Chip key={k} tone={roleTone(k)}>{roleLabel(k)}</Chip>)}
                        </span>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
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
        </CardContent>
      </Card>

      {approveTarget ? (
        <ApproveModal target={approveTarget} teams={teams} onClose={() => setApproveTarget(null)} onDone={() => { setApproveTarget(null); void refetch(); }} />
      ) : null}
    </div>
  );
}
