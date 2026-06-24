# Task 01 — Select 프리미티브 신설

네이티브 `<select>`를 Input 프리미티브와 동일 chrome로 감싼 공용 `Select` 신설.

## Files
- **Create:** `src/components/ui/select.tsx`

## Prep
- 읽기: 엔트리포인트 §SC-1 의 `select.tsx` 전체 코드(그대로 사용), §SC-0 D1(정규 chrome = Input 정렬 근거).
- 대조: `src/components/ui/input.tsx`(동일 chrome 패턴 — h-8/rounded-lg/border-input/focus ring).

## Deps
없음.

## Steps

1. **`src/components/ui/select.tsx` 생성** — 엔트리포인트 §SC-1 `select.tsx` 코드 블록을 그대로 작성한다. 핵심:
   - 네이티브 `<select>` 유지(OS 셀렉트 화살표 유지 — 커스텀 드롭다운 만들지 않음).
   - className은 Input과 동일하되 `type` 분기·placeholder 의사클래스 제외.
   - 기본 `w-full`(필터바는 소비처에서 `className="w-auto"`로 override; `cn`=twMerge라 안전).
   - `data-slot="select"`, `...props` 패스스루(value/onChange/id/disabled 등 네이티브 props 그대로).

2. **검증** (§SC-4):
   ```
   npm run typecheck
   npm run lint
   npm run build
   ```

3. **commit** — 변경 파일 명시 stage(§SC-5): `git add src/components/ui/select.tsx`.

## Acceptance Criteria
- `npm run typecheck` → 에러 0.
- `npm run lint` → 신규 파일 경고/에러 0.
- `npm run build` → 성공.
- 파일이 `Select`를 named export 하고, `React.ComponentProps<"select">`를 받는다(value/onChange/disabled/id 등 그대로 전달).

## Cautions
- **커스텀 드롭다운(div+listbox)으로 만들지 말 것. 이유:** 범위는 "복붙 chrome 통합"이며 네이티브 select 동작(키보드·모바일 네이티브 피커)을 유지해야 함. 마크업 구조 변경은 회귀 위험.
- **`w-full`을 제거하지 말 것. 이유:** 폼 select(다수)는 라벨 블록에서 full-width로 Input과 정렬돼야 함. 필터바만 예외로 override.
- 이 task는 **소비처를 건드리지 않는다**(신규 파일만). 이관은 task-06~08.
