"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT, type WfStatus } from "./labels";

interface TaskItem { id: string; kind: string; typeName: string; scheduledAt: string; status: WfStatus; }

// 이력 목록: 캘린더(운영창 ±MAX_ANCHOR_MONTHS)와 달리 range 없이 GET /api/workflows를 호출해
// 운영창 밖 과거/미래 작업까지 전체 이력을 브라우징한다(감사·과거 발송 확인·재다운로드 진입). 조회는 서버가 권한 kind로 필터.
const FILTERS: Array<{ key: string; label: string; statuses?: string }> = [
  { key: "all", label: "전체" },
  { key: "active", label: "진행중", statuses: "PENDING,GENERATED,REVIEWED" },
  { key: "sent", label: "발송", statuses: "SENT,FINAL_SENT" },
];

async function fetchList(statuses?: string): Promise<TaskItem[]> {
  const qs = statuses ? `?status=${statuses}` : "";
  const res = await fetch(`/api/workflows${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`list ${res.status}`);
  return (await res.json()).items as TaskItem[];
}

export function WorkflowsList() {
  const [filter, setFilter] = useState("all");
  const statuses = FILTERS.find((f) => f.key === filter)?.statuses;
  // queryKey에 "list"를 둬 캘린더(["workflows","calendar",…])와 캐시 키 충돌 방지.
  const query = useQuery({ queryKey: ["workflows", "list", filter], queryFn: () => fetchList(statuses) });
  const items = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={f.key === filter ? "default" : "ghost"}
            aria-pressed={f.key === filter}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {query.isError && <p className="text-sm text-destructive">목록을 불러오지 못했습니다.</p>}

      {items.length === 0 && !query.isLoading ? (
        <p className="text-sm text-muted-foreground">업무가 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map((t) => (
            <li key={t.id}>
              <Link href={`/workflows/${t.id}`} className="flex items-center gap-3 p-3 hover:bg-muted">
                <Badge variant="outline">{KIND_LABEL[t.kind] ?? t.kind}</Badge>
                <span className="font-medium">{t.typeName}</span>
                <span className="text-sm text-muted-foreground">{new Date(t.scheduledAt).toLocaleDateString("ko-KR")}</span>
                <Badge className="ml-auto" variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
