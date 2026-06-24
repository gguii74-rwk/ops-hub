# Task 04 — 사용자 관리 화면 재디자인 (Aurora)

`users-list.tsx`를 Aurora로 재조립한다: PageHeader(eyebrow "구성원" + "＋ 직접 추가") → StatStrip(승인 대기/전체/활성/외주) → Card{pill 툴바 + Chip 테이블}. **react-query·필터 state·페이지네이션·ApproveModal·낙관락은 그대로** 두고 표현만 바꾼다.

## Files

- Modify `src/app/(app)/admin/users/_components/users-list.tsx` (표현 재조립)
- Modify `src/app/(app)/admin/users/page.tsx` (PageSection 래퍼 제거 — 헤더를 UsersList가 소유)

## Prep

- entrypoint §Shared Contracts(프리미티브·stats·톤맵).
- task-01 프리미티브, task-02 톤/표시명 맵, task-03 `stats`.
- 현재 `users-list.tsx`(전문 숙지): `fetchUsers`/`useQuery`/필터 state(`status`/`employmentType`/`jobFunction`/`q`/`page`)/`reset`/`ApproveModal` — **변경 금지**, JSX만 교체.
- 현재 `page.tsx`: `<PageSection title="사용자 관리"><UsersList .../></PageSection>`.

## Deps

01, 02, 03.

## Cautions

- **데이터/권한 로직 불변:** `params` 구성, `queryKey`, `fetchUsers`, `canCreate/canUpdate/canApprove` 분기, `approveTarget` 흐름, `u.updatedAt`(낙관락) 전달 — 한 글자도 바꾸지 않는다. Reason: stale-tab lost-update 차단 등 검증된 동작.
- **`STATUS_VARIANT`(Badge용) 제거하고 `STATUS_TONE`(Chip용)으로 교체.** 다른 화면이 STATUS_VARIANT를 쓰지 않는지 grep 확인 후 import만 교체(파일 내 사용처만). Reason: Chip은 tone, Badge는 variant — 혼용 금지.
- Card 안의 Table은 `bordered={false}`로(이중 테두리 방지). Reason: Card가 이미 테두리.
- page.tsx에서 `PageSection` import 제거 시 **다른 사용처 없음 확인**(이 파일만).

## TDD steps

표현 컴포넌트라 단위테스트 대신 typecheck/lint/build로 계약을 보장한다(기존 패턴 — users-list에 렌더 테스트 없음). 톤/표시명/stats 로직은 task-02/03에서 이미 테스트됨.

### 1. page.tsx — PageSection 래퍼 제거

현재:

```tsx
import { PageSection } from "@/components/ui/page-section";
import { UsersList } from "./_components/users-list";
...
  return (
    <PageSection title="사용자 관리">
      <UsersList
        canCreate={keys.has("admin.users:create")}
        canUpdate={keys.has("admin.users:update")}
        canApprove={keys.has("admin.users:approve")}
        teams={teams}
      />
    </PageSection>
  );
```

수정(헤더는 UsersList가 소유):

```tsx
import { UsersList } from "./_components/users-list";
...
  return (
    <UsersList
      canCreate={keys.has("admin.users:create")}
      canUpdate={keys.has("admin.users:update")}
      canApprove={keys.has("admin.users:approve")}
      teams={teams}
    />
  );
```

(`PageSection` import 줄 삭제. 다른 import는 유지.)

### 2. users-list.tsx — 전체 교체

아래 전문으로 교체한다:

```tsx
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
```

### 3. 검증·커밋

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/app/(app)/admin/users/_components/users-list.tsx "src/app/(app)/admin/users/page.tsx"
git commit -m "feat(admin): 사용자 관리 화면 Aurora 재디자인(StatStrip·pill 툴바·컬러칩)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm test            # green (회귀 없음)
npm run build       # 성공
```

수동 확인 포인트(휴대폰 미리보기): 헤더 eyebrow "구성원" + 직접 추가 버튼, 4개 스탯(승인 대기 강조·클릭 시 PENDING 필터), 상태 pill 토글, 상태/고용/직무/역할이 컬러칩, 페이지네이션 동작. 권한 없는 사용자는 추가/편집 버튼 미노출(분기 불변).
