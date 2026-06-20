"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFullLeaveText, TYPE_LABEL } from "@/modules/leave/labels";

interface Summary {
  allocatedDays: number;
  carriedOverDays: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

interface Recent {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface Person {
  userId: string;
  name: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: string;
  endDate: string;
}

interface AdminBlock {
  totalEmployees: number;
  todayOnLeave: number;
  pendingRequests: number;
  today: Person[];
  tomorrow: Person[];
  upcoming: Person[];
}

interface Resp {
  employee: { summary: Summary | null; usageRate: number; recentRequests: Recent[] };
  admin: AdminBlock | null;
}

async function fetchDashboard(): Promise<Resp> {
  const res = await fetch("/api/leave/dashboard", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return res.json();
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-2xl font-semibold tabular-nums">{value}</span>
  </div>
);

const PeopleList = ({ title, people }: { title: string; people: Person[] }) => (
  <Card className="space-y-2 p-4">
    <h3 className="text-sm font-medium">{title}</h3>
    {people.length === 0 ? (
      <p className="text-sm text-muted-foreground">없음</p>
    ) : (
      <ul className="space-y-1 text-sm">
        {people.map((p, i) => (
          <li key={`${p.userId}-${i}`}>
            {p.name} · {getFullLeaveText(p.leaveType, p.leaveSubType, p.quarterStartTime)}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export function DashboardClient() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["leave", "dashboard"],
    queryFn: fetchDashboard,
  });

  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">불러오는 중…</Card>;
  if (isError || !data)
    return <Card className="p-4 text-sm text-destructive">대시보드를 불러오지 못했습니다.</Card>;

  const s = data.employee.summary;

  return (
    <div className="space-y-6">
      {!s ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {new Date().getFullYear()}년 연차 할당이 설정되지 않았습니다. 관리자에게 문의하세요.
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Stat label="총 연차" value={`${s.totalDays}일`} />
            <Stat label="사용" value={`${s.usedDays}일`} />
            <Stat label="대기" value={`${s.pendingDays}일`} />
            <Stat label="잔여" value={`${s.remainingDays}일`} />
          </Card>
          <Card className="space-y-2 p-4">
            <div className="flex justify-between text-sm">
              <span>사용률</span>
              <span className="tabular-nums">
                {data.employee.usageRate}% ({s.usedDays}/{s.totalDays})
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, data.employee.usageRate)}%` }}
              />
            </div>
            {s.carriedOverDays > 0 && (
              <p className="text-sm text-muted-foreground">
                이월 연차 {s.carriedOverDays}일이 있습니다.
              </p>
            )}
          </Card>
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">최근 신청 내역</h2>
          <Link href="/leave/history" className="text-sm text-muted-foreground hover:text-foreground">
            전체 보기
          </Link>
        </div>
        {data.employee.recentRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">신청 내역이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.employee.recentRequests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
                <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
                <span>{new Date(r.startDate).toLocaleDateString("ko-KR")}</span>
                <span className="ml-auto text-muted-foreground">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.admin && (
        <div className="space-y-3">
          <h2 className="font-medium">전체 현황</h2>
          <Card className="grid grid-cols-3 gap-4 p-4">
            <Stat label="전체 인원" value={`${data.admin.totalEmployees}명`} />
            <Stat label="오늘 휴가중" value={`${data.admin.todayOnLeave}명`} />
            <Stat label="대기 중 신청" value={`${data.admin.pendingRequests}건`} />
          </Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <PeopleList title="오늘" people={data.admin.today} />
            <PeopleList title="내일" people={data.admin.tomorrow} />
            <PeopleList title="예정(7일)" people={data.admin.upcoming} />
          </div>
        </div>
      )}
    </div>
  );
}
