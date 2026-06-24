# Task 06 — admin/users 영역 이관

admin/users 화면군을 공용 Select·Table·Modal·States로 이관(파일 단위 1회 수정).

## Files (Modify)
- `src/app/(app)/admin/users/_components/users-list.tsx` — Table + Select(필터) + States
- `src/app/(app)/admin/users/_components/approve-modal.tsx` — Modal(경로) + Select
- `src/app/(app)/admin/users/_components/user-fields.tsx` — Select
- `src/app/(app)/admin/users/new/_components/create-user-form.tsx` — Select
- `src/app/(app)/admin/users/[id]/_components/user-edit.tsx` — Select + States
- `src/app/(app)/admin/users/[id]/_components/override-panel.tsx` — Table + Select + EmptyState + Input(인접 bare input 정합)

## Prep
- 읽기: 엔트리포인트 §SC-1(프리미티브 API), §SC-0 D1·D2·D3, §SC-2(import 경로).

## Deps
01(Select), 02(Table), 03(Modal), 04(States).

---

## A. users-list.tsx

1. import 추가(파일 상단 import 블록):
```tsx
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
```
2. `const selectCls = "h-8 rounded-lg border border-input bg-background px-2.5 text-sm";` **줄 삭제**.
3. 필터 select 3개 치환(필터바=auto width → `className="w-auto"`):
```tsx
// before: <select className={selectCls} value={status} onChange={...}>...</select>
<Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value as "ALL" | UserStatusKey); reset(); }}>
  {STATUS_FILTER.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s]}</option>)}
</Select>
<Select className="w-auto" value={employmentType} onChange={(e) => { setEmploymentType(e.target.value); reset(); }}>
  <option value="">전체 고용형태</option>
  {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
</Select>
<Select className="w-auto" value={jobFunction} onChange={(e) => { setJobFunction(e.target.value); reset(); }}>
  <option value="">전체 직무</option>
  {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
</Select>
```
4. 로딩/에러 치환:
```tsx
// before: {isLoading ? (<p ...>불러오는 중…</p>) : isError ? (<p ...>불러오지 못했습니다.</p>) : (
{isLoading ? (
  <LoadingState />
) : isError ? (
  <ErrorState />
) : (
```
5. 테이블 블록(`<div className="overflow-x-auto rounded-lg border border-border"><table>…</table></div>`) 전체를 치환:
```tsx
<Table>
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
        <TableCell>{u.name}</TableCell>
        <TableCell className="text-muted-foreground">{u.email}</TableCell>
        <TableCell><Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge></TableCell>
        <TableCell>{EMPLOYMENT_LABEL[u.employmentType]}</TableCell>
        <TableCell>{JOB_LABEL[u.jobFunction]}</TableCell>
        <TableCell className="text-muted-foreground">{u.roleKeys.join(", ") || "-"}</TableCell>
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
```

## B. approve-modal.tsx

1. import 교체: `import { Modal } from "@/app/(app)/leave/_components/modal";` → `import { Modal } from "@/components/ui/modal";`
2. import 추가: `import { Select } from "@/components/ui/select";`
3. `const selectCls = ...;` 줄 삭제.
4. select 2개 → `Select`(폼 = 기본 w-full, className 제거):
```tsx
// 팀
<Select id="ap-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
  <option value="">무소속</option>
  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
</Select>
// systemRole
<Select value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
  {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
</Select>
```

## C. user-fields.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. `const selectCls = ...;` 줄 삭제.
3. select 2개 → `Select`:
```tsx
<Select value={state.employmentType} onChange={(e) => set("employmentType", e.target.value as EmploymentType)}>
  {EMPLOYMENT_OPTIONS.map((v) => <option key={v} value={v}>{EMPLOYMENT_LABEL[v]}</option>)}
</Select>
<Select value={state.jobFunction} onChange={(e) => set("jobFunction", e.target.value as JobFunction)}>
  {JOB_OPTIONS.map((v) => <option key={v} value={v}>{JOB_LABEL[v]}</option>)}
</Select>
```

## D. create-user-form.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. `const selectCls = ...;` 줄 삭제.
3. select 2개 → `Select`:
```tsx
<Select id="team" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)}>
  <option value="">무소속</option>
  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
</Select>
<Select value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
  {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
</Select>
```

## E. user-edit.tsx

1. import 추가: `import { Select } from "@/components/ui/select";` + `import { LoadingState, ErrorState } from "@/components/ui/states";`
2. `const selectCls = ...;` 줄 삭제.
3. 로딩/에러 early-return 치환:
```tsx
if (isLoading) return <LoadingState />;
if (isError || !data) return <ErrorState />;
```
4. select 2개 → `Select`:
```tsx
<Select id="edit-team" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)}>
  <option value="">무소속</option>
  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
</Select>
<Select value={systemRole} onChange={(e) => setSystemRole(e.target.value as SystemRole)}>
  {SYSTEM_ROLE_OPTIONS.map((v) => <option key={v} value={v}>{SYSTEM_ROLE_LABEL[v]}</option>)}
</Select>
```

## F. override-panel.tsx

1. import 추가:
```tsx
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
```
2. `const selectCls = ...;` 줄 삭제.
3. 테이블 분기 치환 — `overrides.length > 0 ? (<div ...><table>…</table></div>) : (<p ...>등록된 예외가 없습니다.</p>)`:
```tsx
{overrides.length > 0 ? (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>권한</TableHead>
        <TableHead>effect</TableHead>
        <TableHead>scope</TableHead>
        <TableHead>사유</TableHead>
        <TableHead>기간</TableHead>
        <TableHead></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {overrides.map((o) => (
        <TableRow key={o.id}>
          <TableCell className="font-mono text-xs">{o.resource}:{o.action}</TableCell>
          <TableCell>{o.effect}</TableCell>
          <TableCell>{o.scope}</TableCell>
          <TableCell className="text-muted-foreground">{o.reason ?? "-"}</TableCell>
          <TableCell className="text-muted-foreground text-xs">
            {o.startsAt ? new Date(o.startsAt).toLocaleDateString("ko-KR") : "—"}
            {" ~ "}
            {o.endsAt ? new Date(o.endsAt).toLocaleDateString("ko-KR") : "무기한"}
          </TableCell>
          <TableCell className="text-right">
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(o.id)}>삭제</Button>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
) : (
  <EmptyState>등록된 예외가 없습니다.</EmptyState>
)}
```
4. select 3개 → `Select`(permissionKey / effect / scope), 옵션 children 그대로:
```tsx
<Select value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)}>
  {PERMISSION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
</Select>
<Select value={effect} onChange={(e) => setEffect(e.target.value as "ALLOW" | "DENY")}>
  <option value="ALLOW">ALLOW</option>
  <option value="DENY">DENY</option>
</Select>
<Select value={scope} onChange={(e) => setScope(e.target.value)}>
  {SCOPE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
</Select>
```
5. 인접 bare `<input>` 3개(사유 text, 시작일/종료일 date)를 `Input`으로 — **우리 Select 변경으로 생길 input↔select 높이 불일치를 같은 파일에서 정합**(기존 Input 프리미티브 사용, 새 프리미티브 아님):
```tsx
<Input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 일시 프로젝트 참여" />
<Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
<Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
```

---

## 검증 (§SC-4)
```
npm run typecheck
npm run lint
npm test
npm run build
```
**육안 parity 체크포인트:** `npm run dev`(또는 kgs-dev) → `/admin/users`(목록 테이블·필터 select·빈상태) → 승인 대기 사용자 "승인·거절" 모달(Select·Escape 닫기·Tab이 모달 밖으로 안 나감·닫으면 직전 focus 복원) → `/admin/users/[id]` 편집(팀/role select·로딩) → 예외 추가 폼(select+input 높이 일치 확인).

## commit
변경 6개 파일을 명시 stage(§SC-5): `git add` 위 6개 경로.

## Cautions
- **`leave/_components/modal.tsx`를 삭제하지 말 것. 이유:** task-07도 같은 구 파일을 import하다 task-10에서 일괄 삭제. 여기선 approve-modal의 import 경로만 교체.
- **bare `<input type="checkbox">`는 그대로 둘 것**(체크박스 프리미티브는 범위 밖). F단계의 Input 정합은 text/date input에만.
- **필터 select에 `w-auto`를 빠뜨리지 말 것. 이유:** Select 기본이 `w-full`이라 누락 시 필터바에서 전체 폭으로 늘어남(회귀).
- 옵션 `<option>` children·value·onChange 로직은 **변경 금지**(chrome만 교체).
