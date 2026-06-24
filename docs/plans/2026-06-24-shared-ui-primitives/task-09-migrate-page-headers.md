# Task 09 — 페이지 헤더 통일

page.tsx들의 타이틀(중복·드리프트)·max-w(제각각)를 PageSection/PageHeader로 통일하고, 권한/빈 메시지를 EmptyState로 치환.

## Files (Modify)
표준 `space-y-4` 페이지 → **PageSection**, 커스텀 spacing 페이지 → **PageHeader**(타이틀만 교체).
- `src/app/(app)/admin/users/page.tsx` — PageSection
- `src/app/(app)/admin/users/new/page.tsx` — PageSection width="form"
- `src/app/(app)/admin/users/[id]/page.tsx` — PageSection width="wide"
- `src/app/(app)/calendar/page.tsx` — PageSection + EmptyState
- `src/app/(app)/leave/manage/page.tsx` — PageSection + EmptyState
- `src/app/(app)/leave/manage/allocations/page.tsx` — PageSection + EmptyState
- `src/app/(app)/workflows/page.tsx` — PageSection + EmptyState
- `src/app/(app)/admin/page.tsx` — PageSection(드리프트 `text-xl` 정규화)
- `src/app/(app)/admin/settings/page.tsx` — PageHeader만(grid gap-6 유지)
- `src/app/(app)/dashboard/page.tsx` — PageHeader(드리프트 정규화, 칩→actions)
- `src/app/(app)/leave/request/page.tsx` — EmptyState(권한 메시지만, 타이틀 없음)

## Prep
- 읽기: 엔트리포인트 §SC-1(PageHeader/PageSection/EmptyState), §SC-0 D5.
- 규칙: import는 `import { PageSection } from "@/components/ui/page-section";`(또는 `PageHeader`), `import { EmptyState } from "@/components/ui/states";`. 서버 컴포넌트의 auth/권한 로직은 **무변경**, return JSX만 교체.

## Deps
04(States/EmptyState), 05(PageSection/PageHeader).

---

## 표준 PageSection 치환

**admin/users/page.tsx** — `import { PageSection }` 추가:
```tsx
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

**admin/users/new/page.tsx** (max-w-lg → `width="form"`):
```tsx
return (
  <PageSection title="사용자 직접 추가" width="form">
    <CreateUserForm teams={teams} />
  </PageSection>
);
```

**admin/users/[id]/page.tsx** (max-w-2xl → `width="wide"`):
```tsx
return (
  <PageSection title="사용자 편집" width="wide">
    <UserEdit userId={id} canUpdate={keys.has("admin.users:update")} teams={teams} />
  </PageSection>
);
```

**calendar/page.tsx** (+EmptyState; `import { PageSection }`·`import { EmptyState }`):
```tsx
return (
  <PageSection title="캘린더">
    {allowedViews.length === 0 ? (
      <EmptyState>표시할 캘린더 권한이 없습니다.</EmptyState>
    ) : (
      <CalendarView allowedViews={allowedViews} />
    )}
  </PageSection>
);
```

**leave/manage/page.tsx**:
```tsx
return (
  <PageSection title="연차 승인">
    {!canView ? <EmptyState>승인 권한이 없습니다.</EmptyState> : <ApprovalsClient />}
  </PageSection>
);
```

**leave/manage/allocations/page.tsx**:
```tsx
return (
  <PageSection title="연차 할당">
    {!canView ? (
      <EmptyState>할당 열람 권한이 없습니다.</EmptyState>
    ) : (
      <AllocationsClient canConfigure={set.has("leave.allocation:configure")} />
    )}
  </PageSection>
);
```

**workflows/page.tsx**:
```tsx
return (
  <PageSection title="업무">
    {allowed.length === 0 ? (
      <EmptyState>열람 권한이 있는 업무가 없습니다.</EmptyState>
    ) : (
      <WorkflowsList />
    )}
  </PageSection>
);
```

**admin/page.tsx** (드리프트 `text-xl font-semibold` → 정규 타이틀):
```tsx
return (
  <PageSection title="관리">
    <p className="text-sm text-muted-foreground">좌측 메뉴에서 사용자 관리·메뉴 관리를 선택하세요.</p>
  </PageSection>
);
```

---

## PageHeader만 (커스텀 spacing 유지)

**admin/settings/page.tsx** — `grid gap-6`(설정 카드 간격) 유지, 타이틀만 교체. `import { PageHeader }` 추가, `<h1 className="text-xl font-semibold">설정</h1>` → `<PageHeader title="설정" />`. 나머지(연동 상태 카드·SettingEditor 등) 무변경.

**dashboard/page.tsx** — 데모 hero. `grid gap-4` 유지, 드리프트 `text-xl` 타이틀 정규화 + "디자인 미리보기" 칩을 `actions`로:
```tsx
import { PageHeader } from "@/components/ui/page-section";
// ...
return (
  <section className="grid gap-4">
    <PageHeader
      title="대시보드"
      actions={
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          디자인 미리보기
        </span>
      }
    />
    <p className="text-sm text-muted-foreground">
      아래 카드는 브랜드 팔레트·타이포그래피 시연용 예시이며 실제 운영 데이터가 아닙니다.
    </p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* sampleMetrics 카드 — 기존 그대로 */}
    </div>
  </section>
);
```
(카드 grid 내부는 **기존 코드 그대로** 유지.)

---

## EmptyState만 (타이틀 없음)

**leave/request/page.tsx** — 페이지 h1 없음(폼 Card에 자체 heading 존재) → **타이틀 추가하지 않음**. 권한 early-return `<p>`만 치환. `import { EmptyState }` 추가:
```tsx
if (!new Set(keys).has("leave.request:create"))
  return <EmptyState>연차 신청 권한이 없습니다.</EmptyState>;
```
나머지(`<div className="space-y-6"><LeaveSummary /><LeaveRequestForm .../></div>`) 무변경.

---

## 검증 (§SC-4)
```
npm run typecheck
npm run lint
npm test
npm run build
```
**육안 parity 체크포인트:** 각 화면 타이틀이 동일 스타일(`font-display text-2xl`)로 통일됐는지, admin/settings·dashboard 타이틀이 커진 것, users/new·[id]가 중앙 정렬 폭(form/wide) 유지, 권한 없는 계정에서 EmptyState 메시지 표시.

## commit
변경 11개 파일 명시 stage(§SC-5).

## Cautions
- **leave/request에 페이지 타이틀을 새로 추가하지 말 것. 이유:** 폼 Card가 이미 "연차 신청" heading 보유 — 중복 방지(범위는 기존 타이틀 통일이지 신규 추가 아님).
- **settings·dashboard에 PageSection을 쓰지 말 것. 이유:** PageSection은 `space-y-4` 강제 → settings의 `gap-6`·dashboard hero 구조가 바뀜. 타이틀만 PageHeader로 교체.
- 서버 컴포넌트 **auth/redirect/권한 계산 로직 무변경** — return JSX만 수정.
- `width` 매핑: 목록=기본 full, users/new=form, users/[id]=wide.
