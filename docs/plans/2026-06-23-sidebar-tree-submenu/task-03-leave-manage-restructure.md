# Task 03 — 연차 관리 라우트 이동 + ManageTabs + LeaveTabs 제거

`/leave/{approvals,allocations,status}` 3개 페이지를 `/leave/manage/*`로 이동하고(공통 prefix로 사이드바 활성 유지), 페이지 내 탭바 `ManageTabs`를 새 `(manage)` 레이아웃에 둔다. 동시에 본문 상단 `LeaveTabs`를 제거한다(트리로 일원화). 연차 영역 변경을 한 태스크로 묶어 깨진 링크 윈도우를 만들지 않는다.

## Files

- Move(git mv): 엔트리포인트 §Shared Contracts **C4** 매핑표대로
  - `leave/approvals/page.tsx` → `leave/manage/page.tsx`
  - `leave/approvals/approvals-client.tsx` → `leave/manage/approvals-client.tsx`
  - `leave/allocations/` → `leave/manage/allocations/`
  - `leave/status/` → `leave/manage/status/`
- Modify: `src/app/(app)/leave/manage/status/page.tsx` — status-client import 경로 한 단계 보정
- Modify: `src/app/(app)/leave/layout.tsx` — `<LeaveTabs/>`·import 제거
- Create: `src/app/(app)/leave/manage/layout.tsx`
- Create: `src/app/(app)/leave/manage/_components/manage-tabs.tsx`
- Delete(git rm): `src/app/(app)/leave/_components/leave-tabs.tsx`

## Prep

- 엔트리포인트 §Shared Contracts **C4**(라우트 이동 매핑)·**C5**(ManageTabs 탭 정의) 숙지.
- spec D4·D5·D11.
- 확인된 사실: 이동 대상 client들은 `/api/admin/leave/*` API만 fetch(페이지 라우트 미참조) → fetch URL 무변경. `LeaveTabs`는 `leave/layout.tsx`에서만 import(테스트 import 없음). API 라우트는 페이지와 분리 → 이동 안 함.

## Deps

없음. (task-01의 NAV가 `leave-manage`→`/leave/manage`를 가리키므로 본 태스크로 그 경로가 실제 생성된다 — 순서상 01 후 권장.)

## Steps

### 1. 라우트 이동(git mv — Bash 사용)

`(app)` 괄호 경로는 PowerShell 인용 문제가 있으니 **Bash 도구(Git Bash)**로 실행한다. 모든 경로를 따옴표로 감싼다.

```bash
cd "D:/workspace/ops-hub"
# approvals → manage 루트(승인 = 인덱스). 파일 단위로 이동(폴더 통째 이동 아님)
git mv "src/app/(app)/leave/approvals/page.tsx" "src/app/(app)/leave/manage/page.tsx"
git mv "src/app/(app)/leave/approvals/approvals-client.tsx" "src/app/(app)/leave/manage/approvals-client.tsx"
rmdir "src/app/(app)/leave/approvals"
# allocations / status 는 하위 세그먼트 유지 → 폴더 통째 이동
git mv "src/app/(app)/leave/allocations" "src/app/(app)/leave/manage/allocations"
git mv "src/app/(app)/leave/status" "src/app/(app)/leave/manage/status"
```

확인: `git status`에 renamed 4건(+폴더 내 파일), 작업트리에 `leave/approvals` 없음.

### 2. status 페이지 import 보정

`src/app/(app)/leave/manage/status/page.tsx`는 한 단계 깊어졌다. import 한 줄을 고친다:

- 변경 전: `import { StatusClient } from "../_components/status-client";`
- 변경 후: `import { StatusClient } from "../../_components/status-client";`

(나머지 줄은 그대로. `status-client.tsx`는 `leave/_components/`에 그대로 둔다 — 이동하지 않음.)

`leave/manage/page.tsx`(구 approvals)와 `leave/manage/allocations/page.tsx`는 `./approvals-client`·`./allocations-client`를 import하며 클라이언트가 동반 이동했으므로 **수정 불필요**. client들의 `@/` 절대 import도 무변경.

### 3. `(manage)` 레이아웃 생성

`src/app/(app)/leave/manage/layout.tsx`:

```tsx
import { ManageTabs } from "./_components/manage-tabs";

export default function LeaveManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <ManageTabs />
      {children}
    </section>
  );
}
```

### 4. ManageTabs 생성

`src/app/(app)/leave/manage/_components/manage-tabs.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCan } from "@/lib/auth/permissions-client";
import { cn } from "@/lib/utils";

interface TabDef {
  href: string;
  label: string;
  resource: string;
  action: string;
}

const TABS: TabDef[] = [
  { href: "/leave/manage", label: "연차 승인", resource: "leave.approval", action: "view" },
  { href: "/leave/manage/allocations", label: "연차 할당", resource: "leave.allocation", action: "view" },
  { href: "/leave/manage/status", label: "연차 현황", resource: "leave.status", action: "view" },
];

// 개별 컴포넌트로 분리 — useCan을 map 루프 안에서 직접 호출하면 react-hooks 규칙 위반(LeaveTabs 패턴 계승).
function Tab({ tab, pathname }: { tab: TabDef; pathname: string }) {
  const allowed = useCan(tab.resource, tab.action);
  if (!allowed) return null;
  // 인덱스 탭(승인)=정확 일치, 나머지=하위 경로 포함.
  const active = tab.href === "/leave/manage" ? pathname === "/leave/manage" : pathname.startsWith(tab.href);
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all",
        active
          ? "border-nav-leave/40 bg-nav-leave/15 font-semibold text-emerald-800 shadow-sm dark:text-emerald-100"
          : "border-transparent text-muted-foreground hover:border-nav-leave/30 hover:bg-nav-leave/10 hover:text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full bg-nav-leave", active ? "opacity-100" : "opacity-60")}
      />
      {tab.label}
    </Link>
  );
}

export function ManageTabs() {
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

### 5. leave/layout.tsx에서 LeaveTabs 제거

`src/app/(app)/leave/layout.tsx` 전체를 아래로 교체(상위 `연차` h1·섹션 래퍼 유지, 탭만 제거):

```tsx
export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">연차</h1>
      {children}
    </section>
  );
}
```

### 6. leave-tabs.tsx 삭제

```bash
git rm "src/app/(app)/leave/_components/leave-tabs.tsx"
```

(`LeaveTabs` import처는 방금 제거한 `leave/layout.tsx`뿐 — 다른 참조 없음. 삭제 전 확인: `grep -rn "leave-tabs\|LeaveTabs" src tests` → 결과 0.)

### 7. 검증

```
npm run typecheck
npm run lint
npm test
npm run build
```

빌드 라우트 트리에 `/leave/manage`, `/leave/manage/allocations`, `/leave/manage/status`가 보이고 `/leave/approvals|allocations|status`는 사라졌는지 확인.

### 8. 커밋

```bash
git add -A "src/app/(app)/leave"
git commit -m "feat(leave): 연차 관리 라우트를 /leave/manage/*로 이동 + 페이지 탭(ManageTabs), 상단 LeaveTabs 제거"
```

(다른 세션과 섞이지 않게 `src/app/(app)/leave` 경로로 한정 stage — git 위생. rename/삭제도 이 경로에 포함됨.)

## Acceptance Criteria

```
npm run typecheck   # 에러 0
npm run lint        # 에러 0
npm test            # 전부 통과
npm run build       # 성공, /leave/manage* 라우트 생성·구 라우트 제거
```

수동 스모크(가능 시 dev): `/leave/manage` 진입 → 승인/할당/현황 탭바 노출, 탭 전환해도 사이드바 `연차 관리` 강조 유지(task-02 active 규칙). 상단 연차 탭 미노출.

**ManageTabs 단위테스트 미추가(의도):** active 로직(인덱스 정확매칭 ternary)·`useCan` 게이트는 제거되는 `LeaveTabs`의 동일 미러이며 선례상 단위테스트가 없었다(client 컴포넌트). parity 유지 — 빌드 + 수동 스모크로 커버. 사이드바 활성 회귀는 task-02의 `computeNavRows` 테스트가 방어.

## Cautions

- **git mv를 쓰고 파일을 재작성하지 말 것.** 이유: 이동 대상 client는 200+행 — 재타이핑은 전사 오류 위험. `git mv`가 내용·이력을 결정적으로 보존하고, 본 태스크는 그 위의 **작은 edit**(status import 1줄)만 명시.
- **status-client.tsx를 이동하지 말 것.** 이유: `leave/_components/`에 두고 page의 상대경로만 한 단계(`../` → `../../`) 보정. 이동하면 다른 참조까지 흔들린다.
- **leave/layout.tsx의 `<h1>연차</h1>`·`space-y-6` 래퍼를 지우지 말 것.** 이유: 모든 연차 페이지의 제목 컨텍스트 — 탭(`LeaveTabs`)만 제거 대상.
- **client의 `/api/admin/leave/*` fetch URL을 바꾸지 말 것.** 이유: API 라우트는 이동하지 않음(페이지만 이동).
- **승인 페이지를 `/leave/manage/approvals`로 두지 말 것.** 이유: 승인 = 인덱스(`/leave/manage` = `page.tsx`)여야 사이드바 `연차 관리`(href `/leave/manage`)가 기본 진입과 일치(spec D5).
