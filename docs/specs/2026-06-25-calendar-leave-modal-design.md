# 캘린더 연차 신청·직접입력 팝업 통일 + 종료일 기본값

- 날짜: 2026-06-25
- 범위: 표현계층(연차 캘린더 진입 UX). 도메인·API·스키마 변경 없음(마이그레이션 없음).

## 배경 / 문제

연차 캘린더(`leave-calendar.tsx`)에서 셀을 클릭하면 뜨는 팝오버에 두 진입이 있다.

- **관리자 직접 입력** — 이미 모달(`CreateLeaveModal`)로 처리된다.
- **이 날짜로 연차 신청(자가)** — `/leave/request?date=` 페이지로 **라우팅**된다. 셀 우상단 `+` 빠른추가 버튼도 같은 페이지로 라우팅된다.

두 진입의 처리 방식이 어긋나(한쪽은 모달, 한쪽은 페이지 이동) UX가 일관되지 않다. 또한 두 경우 모두 선택한 날짜가 `startDate`에만 채워지고 `endDate`는 빈 값이라, 다일 연차(ANNUAL)에서 종료일을 매번 다시 골라야 한다.

## 목표

1. **자가신청도 모달 팝업으로 통일** — `+` 빠른추가와 팝오버 "이 날짜로 연차 신청"이 모두 모달을 연다. 캘린더에서 페이지 이동이 사라진다.
2. **두 모달 모두 종료일 기본값** — 선택한 날짜를 `startDate`와 `endDate` 양쪽에 채운다.

비목표: `/leave/request` 페이지 자체(`LeaveRequestForm`)는 그대로 둔다 — 네비 메뉴 "연차 신청"의 직접 진입 경로다. 자가신청 모달에 잔액 요약은 넣지 않는다(폼만).

## 설계

### 신규: `RequestLeaveModal` (자가신청 전용 모달)

파일: `src/app/(app)/leave/_components/request-leave-modal.tsx`

- props: `{ onClose: () => void; defaultDate?: string }`
- `CreateLeaveModal`을 본뜨되 **UserSelect·알림 체크박스 없음**(폼만).
- 공유 프리미티브 재사용: `Modal`(`@/components/ui/modal`) + `LeaveFields`/`emptyLeaveForm`/`toLeavePayload`(`./leave-fields`).
- 상태 초기값: `{ ...emptyLeaveForm, startDate: defaultDate ?? "", endDate: defaultDate ?? "" }`.
- 제출: `useMutation` → `POST /api/leave/requests`(자가신청 엔드포인트, `userId` 없음), body = `toLeavePayload(state)`.
- 성공: `qc.invalidateQueries({ queryKey: ["leave"] })` 후 `onClose()`.
- title: "연차 신청". 제출 버튼 disabled 조건은 `CreateLeaveModal`과 동일: `m.isPending || !state.startDate || (!single && !state.endDate)`.

### 수정: `CreateLeaveModal` (관리자 직접 입력)

`src/app/(app)/leave/_components/create-leave-modal.tsx` — 초기 상태에 `endDate: defaultDate ?? ""` 추가(현재 `startDate`만 채움). 그 외 동작 변경 없음.

### 수정: `leave-calendar.tsx`

- 자가신청 모달용 상태 `requesting: string | null` 추가(관리자용 `creating`과 분리).
- `quickAdd`(=`onQuickAdd`): `canCreate ? (dateKey) => setRequesting(dateKey) : undefined` — 라우팅 제거.
- 팝오버 "이 날짜로 연차 신청" onClick: `close(); setRequesting(dateKey)` — 라우팅 제거.
- "관리자 직접 입력"은 기존 `setCreating(dateKey)` 유지.
- 본문 하단에 `{requesting !== null && <RequestLeaveModal defaultDate={requesting || undefined} onClose={() => setRequesting(null)} />}` 추가.
- 라우팅을 모두 제거하면 `useRouter`/`router`가 미사용 orphan이 되므로 함께 제거(이 변경이 만든 orphan만 정리).

## 불변식 / 영향

- 표현계층만 변경. 연차 도메인 불변식·API·검증 로직 불변. Prisma 마이그레이션 없음 → 표준 restart 배포.
- `single`(HALF/QUARTER) 유형은 `toLeavePayload`가 `endDate=startDate`로 강제하므로 종료일 기본값은 무해. ANNUAL은 종료일이 채워져 단일일 신청이 즉시 제출 가능(의도된 편의).
- 자가신청 제출 경로(`POST /api/leave/requests`)·권한(`leave.request:create`)은 그대로. 모달은 진입 방식만 바꾼다.

## 테스트

- `tests/app/leave/leave-calendar.test.tsx`
  - react-query 모킹에 `useMutation`/`useQueryClient` 보강(모달이 사용) — 현재는 `useQuery`만 모킹해 모달 렌더 시 깨진다.
  - "자가신청 버튼은 `/leave/request?date=`로 라우팅" 테스트를 **클릭 시 자가신청 모달이 열리는지**(예: title "연차 신청" 다이얼로그 노출) 검증으로 교체.
  - `+` 빠른추가 클릭도 모달을 여는지 확인하는 케이스 추가.
  - 권한별 버튼 노출 테스트(canCreate/canManage)는 유지.
- 신규 `RequestLeaveModal` 단위 테스트: `defaultDate` 전달 시 `startDate`·`endDate` 모두 채워짐, 제출 시 `toLeavePayload` body로 `POST /api/leave/requests` 호출.
