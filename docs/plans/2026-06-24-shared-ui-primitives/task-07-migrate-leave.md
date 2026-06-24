# Task 07 — leave 영역 이관

leave 화면군을 공용 Select·Table·Modal·States로 이관(파일 단위 1회 수정).

## Files (Modify)
- `src/app/(app)/leave/_components/status-client.tsx` — Table + Select(필터) + States
- `src/app/(app)/leave/_components/admin-history.tsx` — Table + Select(필터) + States
- `src/app/(app)/leave/_components/create-leave-modal.tsx` — Modal(경로만)
- `src/app/(app)/leave/_components/edit-leave-modal.tsx` — Modal(경로만)
- `src/app/(app)/leave/_components/leave-fields.tsx` — Select
- `src/app/(app)/leave/leave-request-form.tsx` — Select
- `src/app/(app)/leave/_components/user-select.tsx` — Select

## Prep
- 읽기: 엔트리포인트 §SC-1, §SC-0 D1·D2·D3, §SC-2.

## Deps
01(Select), 02(Table), 03(Modal), 04(States).

---

## A. status-client.tsx

1. import 추가:
```tsx
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
```
2. 팀 필터 select(`<select className="h-9 rounded-md border border-border bg-background px-3 text-sm" ...>`) → `Select`(필터바=auto):
```tsx
<Select className="w-auto" value={team} onChange={(e) => setTeam(e.target.value)}>
  <option value="">전체 팀</option>
  {teams.map((t) => <option key={t} value={t}>{t}</option>)}
</Select>
```
3. 로딩/에러 치환: `<LoadingState />` / `<ErrorState />`.
4. 테이블 치환 — `<Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table>…</table></div></Card>`. Card 유지(shadow), Table은 `bordered={false}`로 이중 테두리 방지:
```tsx
<Card className="overflow-hidden p-0">
  <Table bordered={false}>
    <TableHeader>
      <TableRow>
        <TableHead>이름</TableHead>
        <TableHead>팀</TableHead>
        <TableHead className="text-right">총</TableHead>
        <TableHead className="text-right">사용</TableHead>
        <TableHead className="text-right">대기</TableHead>
        <TableHead className="text-right">잔여</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {filtered.length === 0 ? (
        <TableEmpty colSpan={6}>데이터가 없습니다.</TableEmpty>
      ) : (
        filtered.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.name}</TableCell>
            <TableCell className="text-muted-foreground">{r.teamName ?? "-"}</TableCell>
            <TableCell className="text-right tabular-nums">{r.totalDays}</TableCell>
            <TableCell className="text-right tabular-nums">{r.usedDays}</TableCell>
            <TableCell className="text-right tabular-nums">{r.pendingDays}</TableCell>
            <TableCell className={cn("text-right tabular-nums font-medium", r.remainingDays < 3 ? "text-destructive" : r.remainingDays < 7 ? "text-amber-600" : "text-foreground")}>{r.remainingDays}</TableCell>
          </TableRow>
        ))
      )}
    </TableBody>
  </Table>
</Card>
```
(`cn`·`Card`·`Input`·`buttonVariants` 기존 import 유지.)

## B. admin-history.tsx

1. import 추가:
```tsx
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/ui/states";
```
2. 상태 필터 select(`<select className="h-9 rounded-md border border-border bg-background px-3 text-sm" ...>`) → `Select`(필터바=auto):
```tsx
<Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
  {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "전체 상태" : STATUS_LABEL[s as LeaveStatus]}</option>)}
</Select>
```
3. 로딩/에러 치환: `<LoadingState />` / `<ErrorState />`.
4. 테이블 치환 — `<div className="overflow-x-auto rounded-lg border border-border"><table>…</table></div>`:
```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>이름</TableHead>
      <TableHead>팀</TableHead>
      <TableHead>유형</TableHead>
      <TableHead>기간</TableHead>
      <TableHead>상태</TableHead>
      <TableHead></TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {filtered.map((r) => (
      <TableRow key={r.id}>
        <TableCell>{r.user?.name ?? r.userId}</TableCell>
        <TableCell className="text-muted-foreground">{r.user?.team?.name ?? "-"}</TableCell>
        <TableCell>
          <Badge variant="outline">{TYPE_LABEL[r.leaveType] ?? r.leaveType}</Badge>{" "}
          {getFullLeaveText(r.leaveType, r.leaveSubType, r.quarterStartTime)}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {fmt(r.startDate)}
          {r.endDate !== r.startDate ? ` ~ ${fmt(r.endDate)}` : ""}
        </TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        </TableCell>
        <TableCell className="text-right">
          {(canUpdate || canDelete) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setEdit({
                  id: r.id,
                  leaveType: r.leaveType,
                  leaveSubType: r.leaveSubType,
                  quarterStartTime: r.quarterStartTime,
                  startDate: r.startDate,
                  endDate: r.endDate,
                  reason: r.reason,
                  updatedAt: r.updatedAt,
                })
              }
            >
              수정·삭제
            </Button>
          )}
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```
> 참고: 현재 admin-history는 빈행을 렌더하지 않음 → **TableEmpty 추가하지 않고 parity 유지**(빈 tbody). 동작 변경 금지.

## C. create-leave-modal.tsx / edit-leave-modal.tsx

각 파일 import 한 줄만 교체(나머지 무변경):
```tsx
// before: import { Modal } from "./modal";
import { Modal } from "@/components/ui/modal";
```

## D. leave-fields.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. `const selectCls = ...;`(여러 줄) 삭제.
3. select 3개 → `Select`(폼 = 기본 w-full):
```tsx
<Select value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveFormState["leaveType"])}>
  <option value="ANNUAL">연차</option>
  <option value="HALF">반차(0.5)</option>
  <option value="QUARTER">반반차(0.25)</option>
</Select>
<Select value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
  <option value="MORNING">오전 반차</option>
  <option value="AFTERNOON">오후 반차</option>
</Select>
<Select value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)}>
  {QUARTER_TIME_SLOTS.map((s) => <option key={s.start} value={s.start}>{s.label}</option>)}
</Select>
```

## E. leave-request-form.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. 컴포넌트 내부 `const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";` 줄 삭제.
3. select 3개 → `Select`(id 유지):
```tsx
<Select id="lt" value={state.leaveType} onChange={(e) => set("leaveType", e.target.value as LeaveType)}>
  <option value="ANNUAL">연차</option>
  <option value="HALF">반차(0.5)</option>
  <option value="QUARTER">반반차(0.25)</option>
</Select>
<Select id="st" value={state.leaveSubType} onChange={(e) => set("leaveSubType", e.target.value as "MORNING" | "AFTERNOON")}>
  <option value="MORNING">오전 반차</option>
  <option value="AFTERNOON">오후 반차</option>
</Select>
<Select id="qt" value={state.quarterStartTime} onChange={(e) => set("quarterStartTime", e.target.value)}>
  {QUARTER_TIME_SLOTS.map((s) => <option key={s.start} value={s.start}>{s.label}</option>)}
</Select>
```

## F. user-select.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. 인라인 `<select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" ...>` → `Select`(폼 블록 = 기본 w-full):
```tsx
<Select value={value} onChange={(e) => onChange(e.target.value)}>
  <option value="">{isLoading ? "불러오는 중…" : "사용자를 선택하세요"}</option>
  {data.map((u) => (
    <option key={u.id} value={u.id}>
      {u.name} - {u.team?.name ?? "-"} ({u.email})
    </option>
  ))}
</Select>
```

---

## 검증 (§SC-4)
```
npm run typecheck
npm run lint
npm test
npm run build
```
**육안 parity 체크포인트:** `/leave/request`(신청 폼 유형/시간대 select) → `/leave/manage`(승인) → 연차 현황 화면(status-client 테이블·팀 필터·빈상태) → 관리자 이력(admin-history 테이블·상태 필터) → "연차 직접 입력"·"연차 수정" 모달(UserSelect·LeaveFields·Escape 닫기·Tab이 모달 밖으로 안 나감·닫으면 직전 focus 복원).

## commit
변경 7개 파일 명시 stage(§SC-5).

## Cautions
- **`./modal`(구 파일)을 삭제하지 말 것.** task-10에서 삭제. 여기선 import 경로만 절대경로로 교체.
- **admin-history에 빈행을 새로 추가하지 말 것**(parity — 현재 없음).
- status-client Table은 **`bordered={false}`** 필수(Card가 이미 테두리 제공 → 누락 시 이중 테두리).
- 필터 select(status/team)는 **`className="w-auto"`**, 폼 select(leave-fields/request/user-select)는 className 없이 기본 w-full.
- 옵션·value·onChange·payload 로직 **변경 금지**.
