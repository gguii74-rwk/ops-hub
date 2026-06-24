"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";

interface Row {
  id: string;
  name: string;
  email: string;
  teamName: string | null;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

async function fetchStatus(year: number): Promise<{ items: Row[] }> {
  const res = await fetch(`/api/admin/leave/status?year=${year}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export function StatusClient() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-leave", "status", year],
    queryFn: () => fetchStatus(year),
  });

  const rows = useMemo(() => data?.items ?? [], [data]);
  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.teamName).filter(Boolean) as string[])],
    [rows],
  );
  const filtered = useMemo(
    () => rows.filter((r) => (!team || r.teamName === team) && (!q || r.name.includes(q))),
    [rows, team, q],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          className="w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
        />
        <Select className="w-auto" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">전체 팀</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input
          className="w-40"
          placeholder="이름 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {/* Button은 asChild 미지원(native button props만) → buttonVariants로 스타일한 <a> 사용 */}
        <a
          href={`/api/admin/leave/status/export?year=${year}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          엑셀 내보내기
        </a>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table bordered={false}>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>팀</TableHead>
                <TableHead className="text-right">총</TableHead>
                <TableHead className="text-right">사용</TableHead>
                <TableHead className="text-right">대기</TableHead>
                <TableHead className="text-right">잔여</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableEmpty colSpan={6}>데이터가 없습니다.</TableEmpty>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.teamName ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.totalDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.usedDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pendingDays}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", r.remainingDays < 3 ? "text-destructive" : r.remainingDays < 7 ? "text-amber-600" : "text-foreground")}>{r.remainingDays}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
