"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Alloc {
  id: string;
  userId: string;
  allocatedDays: string;
  carriedOverDays: string;
  usedDays: string;
}

async function fetchAllocations(year: number): Promise<Alloc[]> {
  const res = await fetch(`/api/admin/leave/allocations?year=${year}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`allocations ${res.status}`);
  return (await res.json()).items as Alloc[];
}

async function fetchHolidayStatus(): Promise<number[]> {
  const res = await fetch("/api/admin/leave/holidays/sync", { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return (await res.json()).unsynced as number[];
}

async function post(url: string) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `요청 실패 (${res.status})`);
  return res.json();
}

async function putAllocation(userId: string, year: number, body: { allocatedDays: number; carriedOverDays: number }) {
  const res = await fetch(`/api/admin/leave/allocations/${userId}/${year}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `설정 실패 (${res.status})`);
}

export function AllocationsClient({ canConfigure }: { canConfigure: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [form, setForm] = useState({ userId: "", allocatedDays: "15", carriedOverDays: "0" });
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-leave", "allocations", year],
    queryFn: () => fetchAllocations(year),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-leave", "allocations", year] });

  const recalc = useMutation({
    mutationFn: (userId: string) => post(`/api/admin/leave/allocations/${userId}/${year}/recalculate`),
    onSuccess: invalidate,
  });

  const setAlloc = useMutation({
    mutationFn: () =>
      putAllocation(form.userId, year, {
        allocatedDays: Number(form.allocatedDays),
        carriedOverDays: Number(form.carriedOverDays),
      }),
    onSuccess: () => {
      setForm({ userId: "", allocatedDays: "15", carriedOverDays: "0" });
      invalidate();
    },
  });

  const { data: unsynced = [] } = useQuery({
    queryKey: ["admin-leave", "holiday-status"],
    queryFn: fetchHolidayStatus,
  });

  const syncHolidays = useMutation({
    mutationFn: () => post(`/api/admin/leave/holidays/sync?year=${year}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-leave", "holiday-status"] }),
  });

  return (
    <div className="space-y-4">
      {unsynced.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          공휴일 미동기화: {unsynced.join(", ")}년 — 아래 &quot;{year}년 공휴일 동기화&quot; 버튼으로 동기화하세요(미적재 연도는 직원 신청이 차단됩니다).
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Input
          type="number"
          className="w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
        />
        {canConfigure && (
          <Button
            size="sm"
            variant="outline"
            disabled={syncHolidays.isPending}
            onClick={() => syncHolidays.mutate()}
          >
            {syncHolidays.isPending ? "동기화 중…" : `${year}년 공휴일 동기화`}
          </Button>
        )}
        {syncHolidays.isSuccess && (
          <span className="text-sm text-muted-foreground">
            공휴일 {(syncHolidays.data as { count: number }).count}건
          </span>
        )}
      </div>

      {canConfigure && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">사용자 ID</span>
            <Input
              className="w-56"
              value={form.userId}
              onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
              placeholder="userId"
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">할당일</span>
            <Input
              type="number"
              className="w-24"
              value={form.allocatedDays}
              onChange={(e) => setForm((f) => ({ ...f, allocatedDays: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">이월일</span>
            <Input
              type="number"
              className="w-24"
              value={form.carriedOverDays}
              onChange={(e) => setForm((f) => ({ ...f, carriedOverDays: e.target.value }))}
            />
          </div>
          <Button size="sm" disabled={setAlloc.isPending || !form.userId} onClick={() => setAlloc.mutate()}>
            {year}년 할당 설정
          </Button>
          {setAlloc.isError && (
            <span className="text-sm text-destructive">{(setAlloc.error as Error).message}</span>
          )}
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : data.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">{year}년 할당이 없습니다.</Card>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="font-medium">{a.userId}</span>
              <span className="text-muted-foreground tabular-nums">
                할당 {Number(a.allocatedDays)} · 이월 {Number(a.carriedOverDays)} · 사용 {Number(a.usedDays)}
              </span>
              {canConfigure && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={recalc.isPending}
                  onClick={() => recalc.mutate(a.userId)}
                >
                  사용일 재계산
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
