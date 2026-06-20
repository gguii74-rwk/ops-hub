# Task 04 — leave 영역 layout(가로 탭) + admin 페이지 이전 + 탭 stub

**목적:** `/leave`를 상단 가로 탭(App Router 세그먼트)으로 재구성한다. 기존 `admin/leave/{approvals,allocations}` 페이지를 `/leave/*`로 이전하고, 나머지 탭은 권한 가드된 stub로 만들어 후속 태스크가 교체하게 한다(이 태스크 후 모든 탭이 404 없이 작동).

## Files
- Create: `src/app/(app)/leave/layout.tsx`
- Create: `src/app/(app)/leave/_components/leave-tabs.tsx`
- Move: `src/app/(app)/admin/leave/approvals/page.tsx` → `src/app/(app)/leave/approvals/page.tsx`
- Move: `src/app/(app)/admin/leave/approvals/approvals-client.tsx` → `src/app/(app)/leave/approvals/approvals-client.tsx`
- Move: `src/app/(app)/admin/leave/allocations/page.tsx` → `src/app/(app)/leave/allocations/page.tsx`
- Move: `src/app/(app)/admin/leave/allocations/allocations-client.tsx` → `src/app/(app)/leave/allocations/allocations-client.tsx`
- Delete: `src/app/(app)/admin/leave/` (빈 디렉토리)
- Modify: `src/app/(app)/leave/page.tsx` (바깥 `<h1>연차</h1>` 제거 — layout이 담당)
- Create: `src/app/(app)/leave/request/page.tsx` (stub)
- Create: `src/app/(app)/leave/history/page.tsx` (stub)
- Create: `src/app/(app)/leave/calendar/page.tsx` (stub)
- Create: `src/app/(app)/leave/status/page.tsx` (stub)

## Prep
- 엔트리포인트 §SC-6(라우팅 표). 탭별 진입 권한 확인.
- 패턴 참조: `src/app/(app)/app-nav.tsx`(Link+usePathname+cn), `src/app/(app)/layout.tsx`(PermissionProvider가 이미 상위에 있음 → `useCan` 사용 가능).
- 기존 페이지: `admin/leave/approvals/page.tsx`(leave.approval:view 가드), `admin/leave/allocations/page.tsx`(leave.allocation:view/configure).

## Deps
Task 01(권한 catalog — leave.status:view 키가 seed돼야 status 탭 가드가 의미를 가짐).

## Steps

### 1. 기존 페이지 이전(git mv)
```bash
mkdir -p src/app/(app)/leave/approvals src/app/(app)/leave/allocations
git mv "src/app/(app)/admin/leave/approvals/page.tsx" "src/app/(app)/leave/approvals/page.tsx"
git mv "src/app/(app)/admin/leave/approvals/approvals-client.tsx" "src/app/(app)/leave/approvals/approvals-client.tsx"
git mv "src/app/(app)/admin/leave/allocations/page.tsx" "src/app/(app)/leave/allocations/page.tsx"
git mv "src/app/(app)/admin/leave/allocations/allocations-client.tsx" "src/app/(app)/leave/allocations/allocations-client.tsx"
```
이전된 4개 파일의 **내용은 수정하지 않는다**(상대 import `./approvals-client` 유지, 권한 키 동일). approvals-client의 데이터 소스 변경은 Task 05.

빈 디렉토리 정리:
```bash
rmdir "src/app/(app)/admin/leave/approvals" "src/app/(app)/admin/leave/allocations" "src/app/(app)/admin/leave" 2>/dev/null || true
```

### 2. 탭 컴포넌트

`src/app/(app)/leave/_components/leave-tabs.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCan } from "@/lib/auth/permissions-client";
import { cn } from "@/lib/utils";

interface TabDef { href: string; label: string; resource: string; action: string }

const TABS: TabDef[] = [
  { href: "/leave", label: "대시보드", resource: "leave.request", action: "view" },
  { href: "/leave/request", label: "연차 신청", resource: "leave.request", action: "create" },
  { href: "/leave/history", label: "연차 내역", resource: "leave.request", action: "view" },
  { href: "/leave/calendar", label: "캘린더", resource: "leave.request", action: "view" },
  { href: "/leave/approvals", label: "연차 승인", resource: "leave.approval", action: "view" },
  { href: "/leave/allocations", label: "연차 할당", resource: "leave.allocation", action: "view" },
  { href: "/leave/status", label: "연차 현황", resource: "leave.status", action: "view" },
];

// 개별 컴포넌트로 분리 — useCan을 map 루프 안에서 직접 호출하면 react-hooks 규칙 위반.
function Tab({ tab, pathname }: { tab: TabDef; pathname: string }) {
  const allowed = useCan(tab.resource, tab.action);
  if (!allowed) return null;
  const active = tab.href === "/leave" ? pathname === "/leave" : pathname.startsWith(tab.href);
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm transition-colors",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {tab.label}
    </Link>
  );
}

export function LeaveTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2">
      {TABS.map((tab) => (
        <Tab key={tab.href} tab={tab} pathname={pathname} />
      ))}
    </nav>
  );
}
```

### 3. layout

`src/app/(app)/leave/layout.tsx`:
```tsx
import { LeaveTabs } from "./_components/leave-tabs";

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차</h1>
      <LeaveTabs />
      {children}
    </section>
  );
}
```

### 4. 기존 /leave page.tsx에서 중복 헤더 제거

`src/app/(app)/leave/page.tsx`의 바깥 `<section className="space-y-6">`와 `<h1>연차</h1>`를 제거하고 내용만 반환(layout이 section+h1 제공). 교체:
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";
import { LeaveSummary } from "./leave-summary";
import { LeaveRequestForm } from "./leave-request-form";
import { MyRequests } from "./my-requests";

export default async function LeavePage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  const canView = new Set(keys).has("leave.request:view");
  if (!canView) return <p className="text-sm text-muted-foreground">연차 열람 권한이 없습니다.</p>;
  return (
    <div className="space-y-6">
      <LeaveSummary />
      <LeaveRequestForm />
      <div className="space-y-2">
        <h2 className="font-medium">내 신청 내역</h2>
        <MyRequests />
      </div>
    </div>
  );
}
```
(이 page는 Task 08에서 대시보드로 교체된다 — 지금은 임시로 기존 위젯 유지.)

### 5. 나머지 탭 stub(권한 가드 — 후속 태스크가 교체)

공통 형태로 4개 생성. `src/app/(app)/leave/request/page.tsx`:
```tsx
import { auth } from "@/lib/auth";
import { getPermissionSummary } from "@/kernel/access";

export default async function LeaveRequestPage() {
  const session = await auth();
  const keys = session?.user ? (await getPermissionSummary(session.user.id)).keys : [];
  if (!new Set(keys).has("leave.request:create")) return <p className="text-sm text-muted-foreground">연차 신청 권한이 없습니다.</p>;
  return <p className="text-sm text-muted-foreground">연차 신청 화면은 준비 중입니다.</p>;
}
```
`src/app/(app)/leave/history/page.tsx` — 위와 동일하되 가드 `leave.request:view`, 문구 "연차 내역".
`src/app/(app)/leave/calendar/page.tsx` — 가드 `leave.request:view`, 문구 "연차 캘린더".
`src/app/(app)/leave/status/page.tsx` — 가드 `leave.status:view`, 문구 "연차 현황".

(각 파일은 함수명만 다르게: LeaveHistoryPage / LeaveCalendarPage / LeaveStatusPage.)

## Acceptance Criteria
- `npm run build` → 성공(라우트 `/leave`, `/leave/{request,history,calendar,approvals,allocations,status}` 모두 컴파일).
- `npm run typecheck` → 0 errors.
- `npm run lint` → 통과(특히 `react-hooks/rules-of-hooks` — useCan은 Tab 컴포넌트당 1회).
- `git status`에 `admin/leave/{approvals,allocations}` 삭제 + `leave/{approvals,allocations}` 추가가 mv로 잡힘.

## Cautions
- **Don't** `useCan`을 `TABS.map(() => useCan(...))`처럼 루프 안에서 직접 호출하지 마라. 이유: react-hooks 규칙 위반 → lint 실패. 각 탭을 `Tab` 컴포넌트로 분리한다.
- **Don't** 이전한 approvals/allocations 페이지의 권한 키나 import를 바꾸지 마라(이 태스크 범위 밖). approvals 데이터 소스 변경은 Task 05.
- **Don't** stub 페이지에서 권한 가드를 빼지 마라. 이유: 메뉴 숨김은 UX일 뿐 — 라우트도 같은 키를 검사해야 한다(access-control 규칙 1).
