"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  name: string;
  email: string;
  department: string | null;
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
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-leave", "status", year],
    queryFn: () => fetchStatus(year),
  });

  const rows = useMemo(() => data?.items ?? [], [data]);
  const depts = useMemo(
    () => [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])],
    [rows],
  );
  const filtered = useMemo(
    () => rows.filter((r) => (!dept || r.department === dept) && (!q || r.name.includes(q))),
    [rows, dept, q],
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
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
        >
          <option value="">전체 부서</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
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
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : isError ? (
        <p className="text-sm text-destructive">불러오지 못했습니다.</p>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2">이름</th>
                  <th className="p-2">부서</th>
                  <th className="p-2 text-right">총</th>
                  <th className="p-2 text-right">사용</th>
                  <th className="p-2 text-right">대기</th>
                  <th className="p-2 text-right">잔여</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-muted-foreground">
                      데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 text-muted-foreground">{r.department ?? "-"}</td>
                      <td className="p-2 text-right tabular-nums">{r.totalDays}</td>
                      <td className="p-2 text-right tabular-nums">{r.usedDays}</td>
                      <td className="p-2 text-right tabular-nums">{r.pendingDays}</td>
                      <td
                        className={cn(
                          "p-2 text-right tabular-nums font-medium",
                          r.remainingDays < 3
                            ? "text-destructive"
                            : r.remainingDays < 7
                              ? "text-amber-600"
                              : "text-foreground",
                        )}
                      >
                        {r.remainingDays}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
