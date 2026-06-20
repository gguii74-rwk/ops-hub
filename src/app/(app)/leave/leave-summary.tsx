"use client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";

interface Summary {
  year: number; allocatedDays: number; carriedOverDays: number; totalDays: number;
  usedDays: number; pendingDays: number; remainingDays: number; carriedOverExpiryDate: string | null;
}

async function fetchSummary(): Promise<Summary | null> {
  const res = await fetch("/api/leave/summary", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  return (await res.json()).summary as Summary | null;
}

const Cell = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-lg font-semibold tabular-nums">{value}</span>
  </div>
);

export function LeaveSummary() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["leave", "summary"], queryFn: fetchSummary });
  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">불러오는 중…</Card>;
  if (isError) return <Card className="p-4 text-sm text-destructive">요약을 불러오지 못했습니다.</Card>;
  if (!data) return <Card className="p-4 text-sm text-muted-foreground">{new Date().getFullYear()}년 연차 할당이 설정되지 않았습니다. 관리자에게 문의하세요.</Card>;
  const d = (n: number) => `${n}일`;
  return (
    <Card className="grid grid-cols-3 gap-4 p-4 sm:grid-cols-6">
      <Cell label="할당" value={d(data.allocatedDays)} />
      <Cell label="이월" value={d(data.carriedOverDays)} />
      <Cell label="총" value={d(data.totalDays)} />
      <Cell label="사용" value={d(data.usedDays)} />
      <Cell label="대기" value={d(data.pendingDays)} />
      <Cell label="잔여" value={d(data.remainingDays)} />
    </Card>
  );
}
