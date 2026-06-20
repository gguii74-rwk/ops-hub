# Task 10 — 연차 내역(일반/관리자 분기 page)

**목적:** 본인 내역(상태 탭·카드·관리자 등록/수정 뱃지)과 관리자 전체 내역(년/월/상태/이름·부서 필터·표·수정/삭제)을 제공한다. 권한별로 화면과 컨트롤을 분리한다(spec §6.3).

## Files
- Modify: `src/app/(app)/leave/history/page.tsx` (Task 04 stub → 실제)
- Create: `src/app/(app)/leave/_components/history-client.tsx`
- Create: `src/app/(app)/leave/_components/my-history.tsx`
- Create: `src/app/(app)/leave/_components/admin-history.tsx`

## Prep
- 엔트리포인트 §SC-2(전체이력=`leave.admin:view`, 수정=`leave.request:update`, 삭제=`leave.request:delete`), §SC-5(labels).
- API: 본인 `GET /api/leave/requests?status=`(listMyRequests), 관리자 `GET /api/admin/leave/requests?status=&userId=`(Task 05에서 `leave.admin:view`로 가드 + user 병합).
- 응답 항목은 `LeaveRequest` 전체 필드(createdByAdminId·modifiedByAdminId·adminActionNote 포함) + (관리자) `user{name,department,email}`.
- 모달: Task 07 `EditLeaveModal`(`EditTarget`).

## Deps
Task 02(labels), Task 05(전체이력 권한·user 병합), Task 07(EditLeaveModal).

## Steps

### 1. page — 권한 키 전달
`src/app/(app)/leave/history/page.tsx` 교체:
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { HistoryClient } from "../_components/history-client";

export default async function LeaveHistoryPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const set = new Set(keys);
  if (!set.has("leave.request:view")) return <p className="text-sm text-muted-foreground">연차 내역 권한이 없습니다.</p>;
  return <HistoryClient canAdminView={set.has("leave.admin:view")} canUpdate={set.has("leave.request:update")} canDelete={set.has("leave.request:delete")} />;
}
```

### 2. history-client — 모드 분기
`src/app/(app)/leave/_components/history-client.tsx`:
```tsx
"use client";
import { MyHistory } from "./my-history";
import { AdminHistory } from "./admin-history";

export function HistoryClient({ canAdminView, canUpdate, canDelete }: { canAdminView: boolean; canUpdate: boolean; canDelete: boolean }) {
  // 관리자 전체 이력 권한이 있으면 전체 내역, 없으면 본인 내역.
  return canAdminView ? <AdminHistory canUpdate={canUpdate} canDelete={canDelete} /> : <MyHistory />;
}
```

### 3. my-history — 본인 상태 탭 + 카드
`src/app/(app)/leave/_components/my-history.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TYPE_LABEL, STATUS_LABEL, STATUS_VARIANT, getFullLeaveText, type LeaveStatus } from "@/modules/leave/labels";

interface Req { id: string; leaveType: string; leaveSubType: string | null; quarterStartTime: string | null; startDate: string; endDate: string; days: string; status: LeaveStatus; reason: string | null; createdByAdminId: string | null; modifiedByAdminId: string | null; adminActionNote: string | null; }

const TABS: { key: string; label: string; status?: LeaveStatus }[] = [
  { key: "ALL", label: "전체" }, { key: "PENDING", label: "대기중", status: "PENDING" },
  { key: "APPROVED", label: "승인됨", status: "APPROVED" }, { key: "REJECTED", label: "반려됨", status: "REJECTED" },
  { key: "CANCELLED", label: "취소됨", status: "CANCELLED" },
];

async function fetchMine(status?: LeaveStatus): Promise<Req[]> {
  const res = await fetch(`/api/leave/requests${status ? `?status=${status}` : ""}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`requests ${res.status}`);
  return (await res.json()).items as Req[];
}

export function MyHistory() {
  const [tab, setTab] = useState("ALL");
  const cur = TABS.find((t) => t.key === tab);
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["leave", "history", tab], queryFn: () => fetchMine(cur?.status) });
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn("rounded-full px-3 py-1 text-sm", tab === t.key ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted")}>{t.label}</button>
        ))}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : isError ? <p className="text-sm text-destructive">불러오지 못했습니다.</p> : data.length === 0 ? <p className="text-sm text-muted-foreground">내역이 없습니다.</p> : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>
              <span>{getFullLeaveText(r.leaveType, r.leaveSubType, r.quarterStartTime)}</span>
              <span className="text-muted-foreground">{fmt(r.startDate)}{r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}</span>
              <span className="tabular-nums text-muted-foreground">{Number(r.days)}일</span>
              {r.createdByAdminId && <Badge variant="secondary">관리자 등록</Badge>}
              {r.modifiedByAdminId && <Badge variant="secondary">관리자 수정</Badge>}
              <Badge className="ml-auto" variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### 4. admin-history — 전체 필터 표 + 수정/삭제
`src/app/(app)/leave/_components/admin-history.tsx`:
```tsx
"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TYPE_LABEL, STATUS_LABEL, STATUS_VARIANT, getFullLeaveText, type LeaveStatus } from "@/modules/leave/labels";
import { EditLeaveModal, type EditTarget } from "./edit-leave-modal";
import { CreateLeaveModal } from "./create-leave-modal";

interface Row {
  id: string; userId: string; leaveType: "ANNUAL" | "HALF" | "QUARTER"; leaveSubType: "MORNING" | "AFTERNOON" | null;
  quarterStartTime: string | null; startDate: string; endDate: string; days: string; status: LeaveStatus; reason: string | null;
  createdByAdminId: string | null; modifiedByAdminId: string | null; user: { name: string; department: string | null } | null;
}
const STATUSES: ("ALL" | LeaveStatus)[] = ["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"];

async function fetchAll(status: string): Promise<Row[]> {
  const res = await fetch(`/api/admin/leave/requests${status !== "ALL" ? `?status=${status}` : ""}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`requests ${res.status}`);
  return (await res.json()).items as Row[];
}

export function AdminHistory({ canUpdate, canDelete }: { canUpdate: boolean; canDelete: boolean }) {
  const [status, setStatus] = useState("ALL");
  const [year, setYear] = useState<string>("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["admin-leave", "history", status], queryFn: () => fetchAll(status) });

  const filtered = useMemo(() => data.filter((r) => {
    if (year && new Date(r.startDate).getFullYear() !== Number(year)) return false;
    if (q && !(r.user?.name.includes(q) || (r.user?.department ?? "").includes(q))) return false;
    return true;
  }), [data, year, q]);
  const fmt = (s: string) => new Date(s).toLocaleDateString("ko-KR");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s as LeaveStatus]}</option>)}
        </select>
        <Input type="number" className="w-24" placeholder="연도" value={year} onChange={(e) => setYear(e.target.value)} />
        <Input className="w-40" placeholder="이름/부서 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {canUpdate && <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>+ 연차 직접 입력</Button>}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : isError ? <p className="text-sm text-destructive">불러오지 못했습니다.</p> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="p-2">이름</th><th className="p-2">부서</th><th className="p-2">유형</th><th className="p-2">기간</th><th className="p-2">상태</th><th className="p-2"></th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2">{r.user?.name ?? r.userId}</td>
                  <td className="p-2 text-muted-foreground">{r.user?.department ?? "-"}</td>
                  <td className="p-2"><Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge> {getFullLeaveText(r.leaveType, r.leaveSubType, r.quarterStartTime)}</td>
                  <td className="p-2 text-muted-foreground">{fmt(r.startDate)}{r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}</td>
                  <td className="p-2"><Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                  <td className="p-2 text-right">
                    {(canUpdate || canDelete) && (
                      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, leaveType: r.leaveType, leaveSubType: r.leaveSubType, quarterStartTime: r.quarterStartTime, startDate: r.startDate, endDate: r.endDate, reason: r.reason })}>수정</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EditLeaveModal target={edit} onClose={() => setEdit(null)} />}
      {creating && <CreateLeaveModal onClose={() => setCreating(false)} />}
    </div>
  );
}
```
**주의:** EditLeaveModal의 수정/삭제 버튼 노출은 모달 내부에서 따로 제어하지 않으므로, 수정 진입(`수정` 버튼)을 `canUpdate || canDelete`로 게이트한다. 서버가 PATCH=update, DELETE=delete를 각각 가드하므로 권한 없는 작업은 403로 거부된다(UI 게이트는 보조). 더 엄밀히 하려면 EditLeaveModal에 `canUpdate`/`canDelete` prop을 넘겨 버튼을 숨긴다(선택).

## Acceptance Criteria
- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test` → 통과.
- 코드 점검: `leave.admin:view` 없는 사용자는 `MyHistory`만(전체 데이터 fetch 안 함), 수정/삭제 컨트롤은 `leave.request:update`/`delete` 게이트.

## Cautions
- **Don't** 본인 내역에서 `/api/admin/leave/requests`를 호출하지 마라 — 권한 없으면 403이고, 본인은 `/api/leave/requests`다.
- **Don't** 관리자 수정/삭제 버튼을 권한 게이트 없이 노출하지 마라(메뉴 숨김=UX, 서버가 권위지만 UI도 같은 키 검사).
- **Don't** soft-delete된 항목이 목록에 나오리라 가정하지 마라 — 서버 listRequests가 `deletedAt: null`로 제외한다(Task 06).
