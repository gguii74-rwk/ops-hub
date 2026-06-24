# Task 08 — 기타 Select 사이트 이관

남은 `selectCls` 복붙 2파일(navigation 편집기·가입 폼)을 공용 Select로 이관.

## Files (Modify)
- `src/app/(app)/admin/navigation/_components/navigation-editor.tsx` — Select 2개
- `src/app/signup/_components/signup-form.tsx` — Select 2개

## Prep
- 읽기: 엔트리포인트 §SC-1(Select), §SC-0 D1.

## Deps
01(Select).

---

## A. navigation-editor.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. `const selectCls = "h-9 w-full rounded-md border border-border bg-background px-3 text-sm";` 줄 삭제.
3. select 2개 → `Select`(둘 다 기본 w-full 유지 — 원본도 w-full):
```tsx
// 부모 메뉴 (flex gap-2 안, 이동 버튼과 함께 — w-full 유지)
<Select value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
  <option value="">— 대메뉴(최상위) —</option>
  {parents.filter((p) => p.id !== editingId).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
</Select>

// 필요 권한
<Select value={form.permissionSelect} onChange={(e) => set("permissionSelect", e.target.value)}>
  <option value="">— 권한 선택 —</option>
  <option value={PUBLIC_OPTION}>공개 — 로그인한 모든 사용자</option>
  {permissions.map((p) => <option key={p.id} value={p.id}>{permLabel(p)}</option>)}
</Select>
```

## B. signup-form.tsx

1. import 추가: `import { Select } from "@/components/ui/select";`
2. `const selectCls = ...;` 줄 삭제.
3. select 2개 → `Select`(폼 블록 = 기본 w-full):
```tsx
<Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
  {EMPLOYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
</Select>
<Select value={jobFunction} onChange={(e) => setJobFunction(e.target.value as JobFunction)}>
  {JOB_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
**육안 parity 체크포인트:** `/admin/navigation`(메뉴 추가/편집 카드의 부모·권한 select) → `/signup`(고용형태·직무 select).

## commit
변경 2개 파일 명시 stage(§SC-5).

## Cautions
- navigation-editor 부모 select는 **w-auto로 바꾸지 말 것**(원본 w-full, 이동 버튼과 flex 행에서 채움 동작 유지).
- `signup`은 `(app)` 밖이지만 Select는 글로벌 프리미티브라 무관.
- 옵션·value·onChange **변경 금지**.
