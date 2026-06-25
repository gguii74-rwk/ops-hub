# 캘린더 통일 — `CalendarMonth` 단일 컴포넌트 (설계 spec)

> 작성일 2026-06-25 · 상태: 설계 확정(brainstorming 완료, 사용자 결정 반영) · 후속: `dev-workflow:writing-plans-split` → SDD 구현
> 계보:
> - `docs/specs/2026-06-19-phase-3-calendar-design.md` — 통합 캘린더(feed 합성·권한 마스킹·`buildMonthGrid`). **데이터/권한 계층은 본 spec에서 무변경.**
> - `docs/specs/2026-06-20-leave-area-redesign-design.md` — 연차 영역 재설계(연차 전용 캘린더 포함). 본 spec이 그 연차 캘린더의 **표현 계층을 통합 컴포넌트로 흡수**한다.
> - 디자인 방향 SSOT: 메모리 `ops-hub-calendar-design-direction.md`(소프트 카드 + 색강도 3안), 디자인 시스템 `ops-hub-admin-ui-design-direction.md`(Aurora).

## 1. 배경과 목적

ops-hub에는 월간 캘린더가 **두 벌** 따로 구현돼 있고 시각·동작·코드가 모두 갈라져 있다.

- **통합 캘린더** `src/app/(app)/calendar/calendar-view.tsx` — 좋은 그리드 로직(`buildMonthGrid`: KST·`isPast`/`isToday`/`inMonth`)을 갖지만, 셀이 bordered grid(소프트 카드 아님)이고 **기간 막대·팝오버·범례 필터·빠른추가가 전부 없으며**, 날짜마다 이벤트를 단순 반복 렌더한다.
- **연차 캘린더** `src/app/(app)/leave/_components/leave-calendar.tsx` — 그리드를 자체 재구현(`leadBlanks`만, **과거/오늘 구분 없음**), `leaveType`·`status`별 색으로 정보를 구분하고, 날짜 클릭 → `/leave/request?date=` 라우트 이동 + `+ 연차 입력` 버튼으로 신청에 진입한다. 정적 범례.
- 두 화면의 **이벤트 모델조차 다르다**(`CalEvent` vs `Ev`).

본 spec은 두 화면을 **단일 재사용 컴포넌트 `CalendarMonth`로 통일**하고, 디자인 방향(소프트 카드 + 공통 표준)을 한 곳에 구현한 뒤 두 소비처가 자기 도메인 데이터를 **어댑터로 주입**하게 만든다. 변경은 **클라이언트 표현 계층에 한정**한다 — feed/연차 API, 권한 마스킹, 연차 도메인 트랜잭션·불변식은 한 줄도 건드리지 않는다.

이미 존재하는 기반(재사용 대상):

- 그리드: `src/modules/calendar/ui/grid.ts`(`buildMonthGrid`/`GridDay`), `src/modules/calendar/time.ts`(KST·`normalizeToGridWindow`·`WEEK_STARTS_ON`)
- 통합 데이터: `GET /api/calendar/feed?view=&start=` → `FeedResponse`(`CalEvent[]`/`staleSources`/`failedSources`), kind enum `CalendarEventKind`
- 연차 데이터: `GET /api/leave/calendar?start=&end=` → `Ev[]`, 라벨 헬퍼 `src/modules/leave/labels.ts`(`getFullLeaveText`·`TYPE_LABEL`)
- 디자인 토큰: `src/app/globals.css`(브랜드 #2563EB·네비 팔레트), 프리미티브 `src/components/ui/`(Aurora)

## 2. 범위

### 포함 (IN)

- `CalendarMonth` 단일 컴포넌트 + lane packing 순수 함수 신설(`src/modules/calendar/ui/`).
- 공통 이벤트 모델 `CalendarEventInput`과 색/오버레이 매핑 정의.
- 공통 표준 구현: 소프트 카드 셀·시간 방향(과거/오늘/미래)·**기간 연속 막대(lane packing)**·셀 클릭 **팝오버**·범례 클릭 필터·hover 빠른추가(+)·공휴일 강조·키보드/Esc/`reduced-motion`.
- **두 소비처 마이그레이션**(한 spec, 둘 다): `calendar-view.tsx`·`leave-calendar.tsx`를 `CalendarMonth` + 도메인 어댑터로 재작성.
- 연차 진입점 흡수: 기존 `/leave/request?date=` 이동·`+ 연차 입력` 버튼을 팝오버/빠른추가로 통합.

### 제외 (OUT)

- feed/연차 API, 권한 마스킹, 출처 합성·dedup, 캐시 — **무변경**.
- 연차 도메인 로직(트랜잭션·status-CAS·`usedDays` 캐시·공휴일 fail-closed·중복신청 차단·`MailDelivery`) — **무변경**.
- 새 권한·스키마·마이그레이션 — 없음.
- 주/일(week/day) 뷰, 드래그 이동/리사이즈, 인라인 편집 — 본 spec은 **월간(month) 뷰**만.
- 향후 일정성 모듈(예약·회의실 등) 실제 적용 — `CalendarMonth`가 그것을 **받을 수 있게** 설계하되, 그 화면 구현은 별도.

## 3. 결정 기록 (Decisions)

> codex 적대검증은 아래 결정·상위 캘린더/연차 spec·메모리 디자인 방향을 모른다. finding이 이 결정과 충돌하면 버그가 아니라 의도된 설계다 — 고치기 전 대조할 것. 특히 D10(불변식 보존)을 "표현 계층이 도메인 로직을 호출하지 않는다"는 누락으로 오인하지 말 것.

| # | 결정 |
| --- | --- |
| **D1** | **단일 컴포넌트 `CalendarMonth`, 위치 = `src/modules/calendar/ui/calendar-month.tsx`.** `src/components/ui/`(프리미티브)에 둘 수 없다 — eslint boundaries상 `ui`는 `module`을 import 못 하는데(`from:["ui"], allow:["ui","lib"]`) 컴포넌트가 `grid.ts`(calendar 모듈)에 의존하기 때문. 두 소비처(`app/(app)/calendar`, `app/(app)/leave/_components`)는 모두 **app 레이어**라 module을 import할 수 있다(`from:["app"], allow:[…,"module","ui"]`). |
| **D2** | **공통 이벤트 모델 `CalendarEventInput { id; title; kind; start; end?; status? }`(메모리 확정 모델).** 도메인 모델(`CalEvent`/`Ev`)→이 모델 변환은 **각 소비처(app)의 어댑터**가 담당. `CalendarMonth`는 도메인을 모른다. 공통 타입은 calendar 모듈에 둔다. |
| **D3** | **색 강도 = `intensity` prop(`"soft" \| "bold"`), 화면 단위.** 연차 = `soft`, 통합 업무 = `bold`. `minimal`은 목업의 3안 중 하나지만 본 spec 소비처에선 미사용 → **타입에 넣지 않는다**(YAGNI; 향후 모듈이 필요로 하면 그때 추가). |
| **D4** | **kind → 색 매핑(공통 SSOT, 네비 팔레트 계승).** 통합: `INTERNAL_LEAVE`→emerald, `EXTERNAL_VACATION`→lime, `WORKFLOW_TASK`→orange, `HOLIDAY`→rose, `EXTERNAL_EVENT`→slate, `PERSONAL_EVENT`→indigo, `TEAM_EVENT`→cyan. **연차 전용은 `leaveType`을 kind로 매핑해 종류별 색 유지(soft)**: `ANNUAL`→emerald, `HALF`→teal, `QUARTER`→cyan. kind는 자유 문자열, 매핑에 없으면 중립 색 폴백. |
| **D5** | **status → 오버레이(형태), kind 색과 직교 분리.** `PENDING`=점선 테두리(잠정), `REJECTED`/`CANCELLED`=취소선 + 흐림(`opacity`). `APPROVED`/없음=기본. **상태를 색으로 표현하지 않는다**(기존 연차의 대기 amber·반려 muted를 색에서 오버레이로 이전) → 종류 색과 상태가 동시에 읽힌다. 반려/취소 이벤트의 표시 여부는 어댑터가 필터로 결정(기본: 통합 feed는 서버가 이미 걸러줌, 연차는 기존대로 표시 후 취소선). |
| **D6** | **시간 방향(공통 표준), `GridDay`의 `isPast`/`isToday` 활용.** 지난날=가라앉음(음영·콘텐츠 `opacity`↓), 오늘=브랜드블루 링+숫자 채움, 미래=떠있는 소프트 카드. 연차 캘린더는 현재 이 구분이 없으므로 통합 `buildMonthGrid`로 교체하며 **자동 획득**. `now`는 prop 주입 가능(테스트 결정성). |
| **D7** | **기간 이벤트 = 주 단위 연속 막대(lane packing).** `start~end`가 여러 날에 걸치면 한 주(7열) 안에서 CSS grid column-span으로 이어진 막대로 그린다. 같은 주에 겹치는 막대는 lane(행)으로 분리. 주 경계로 잘리면 좌/우 연속 표시(◂/▸). 단일일 이벤트는 칩. lane 계산은 **순수 함수 `packWeekLanes`로 분리**해 단위 테스트(`src/modules/calendar/ui/lanes.ts`). |
| **D8** | **셀 클릭 → 팝오버. 내용·액션은 호출부 주입.** `CalendarMonth`가 팝오버 컨테이너(위치 계산·뷰포트 클램프·Esc·포커스 트랩·바깥 클릭 닫기)를 제공하고, **내용은 `renderDayDetail(ctx)` prop**으로 주입받는다. 통합 = **읽기전용**(그 날 이벤트 상세). 연차 = 그 날 연차 목록 + `canManage`면 신청 액션. 도메인 규칙(과거 날짜 신청 차단 등)은 **주입 액션 쪽**에서 처리 — 컴포넌트는 모른다. |
| **D9** | **hover 빠른추가(+) = `onQuickAdd?(dateKey)` 주입 시에만 노출(마우스 hover affordance).** 미주입이면 미표시. 연차(`canManage`)만 사용, 통합은 미주입=읽기전용. **키보드 사용자**는 셀 포커스→Enter로 팝오버를 열어 그 안의 신청 액션(D8)을 쓴다 — 빠른추가(+)는 보조 단축일 뿐 유일 경로가 아니다(키보드 접근성 보장). |
| **D10** | **불변식 보존 — 표현 계층만 변경.** feed/연차 API 라우트·권한 마스킹(`masked`/`tentative`)·연차 트랜잭션·status-CAS·`usedDays` 캐시·공휴일 fail-closed 동기화·중복신청 차단·`MailDelivery` — **전부 무변경**. 본 작업은 클라이언트 컴포넌트 교체이며 서버/도메인 호출 시그니처를 바꾸지 않는다. |
| **D11** | **연차 진입점 흡수(라우트 → 팝오버/빠른추가).** 기존 날짜 클릭→`/leave/request?date=` 라우트 이동과 본문 `+ 연차 입력` 버튼을 팝오버 액션·빠른추가(+)로 옮긴다. 신청 자체는 기존 `CreateLeaveModal`을 재사용(모달 호출만 팝오버/+에서 트리거) — **신청 폼·검증·제출 경로는 무변경**. 라우트 `/leave/request`는 사이드바 트리 항목으로 존속(사이드바 spec D3)하며 본 변경은 캘린더 내 진입만 바꾼다. |
| **D12** | **범례 클릭 필터 = 클라이언트 로컬 state.** kind별 토글로 표시/숨김. 서버 재요청 없음(이미 받은 events를 클라이언트에서 필터). 통합은 현재 보이는 kind 집합, 연차는 종류(연차/반차/반반차) + 상태로 구성. 필터는 표시 전용이라 도메인·권한에 영향 없음. |
| **D13** | **반응형/a11y.** 휴대폰이 cutover 경로(메모리 `ops-hub-phone-test-via-dev-deploy`)이므로 좁은 폭에서 셀 축소·기간 막대 유지. 키보드 셀 포커스 이동(방향키/Tab)·Esc 팝오버 닫기·`prefers-reduced-motion` 존중·팝오버 `role=dialog`/`aria` 라벨. |
| **D14** | **날짜 범위 계약 = half-open `[start, end)` instant(KST 일자 기준), 어댑터가 출처별 의미차를 흡수.** `CalendarEventInput`의 `start`/`end`는 ISO instant이며 **half-open으로 해석**한다 — 기존 `grid.ts`(`buildMonthGrid` 필터 `s < dayEnd && dayStart < en`)·`time.ts` 규약과 동일. **이는 두 출처의 end 의미가 다르기 때문에 필수다**: 통합 feed의 `CalEvent`는 이미 `allDayHalfOpen`로 **half-open exclusive end**(time.ts)이고, 연차 `Ev.endDate`는 **inclusive 종료일**(leave-calendar `eventsOn`이 `key <= endDate`로 비교)이다. **어댑터 정규화 규칙**: ① 통합 — feed가 이미 half-open이므로 `start`/`end` 그대로. ② 연차 — `time.ts`의 `allDayHalfOpen(startDate, endDate)`(= `end`를 inclusive 종료일 다음날 00:00 KST로) 재사용해 변환. ③ `end` 생략 = 단일일 `[kstDayStart, +1일)`. 이로써 lane packing은 단일 계약만 보면 된다. |

## 4. 공통 이벤트 모델 & 매핑

```ts
// src/modules/calendar/ui/ (calendar 모듈)
export interface CalendarEventInput {
  id: string;
  title: string;
  kind: string;          // 색 키 — KIND_COLOR 매핑(D4). 자유 문자열, 미등록 시 중립 폴백.
  start: string;         // ISO instant — half-open 범위의 시작(포함). D14.
  end?: string;          // ISO instant — half-open 범위의 끝(제외). 없으면 단일일 [kstDayStart, +1일). D14.
  status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | null; // 오버레이(D5)
}
```

- **날짜 범위(D14)**: `start`/`end`는 **half-open `[start, end)` instant**. 두 출처의 end 의미가 달라(통합=exclusive, 연차=inclusive) 이 계약이 필수.
- **kind→색**: 공통 매핑 테이블(`kind-styles.ts`). 각 색은 `intensity`(soft/bold)에 따라 Tailwind 클래스 묶음을 만든다. 현재 `calendar-view.tsx`의 `KIND_CLASS`(이미 soft 스타일)를 이 SSOT로 이전하고 bold variant를 추가한다.
- **status→오버레이**: kind 색과 독립. PENDING(점선)·REJECTED/CANCELLED(취소선+흐림).
- **어댑터(소비처)**:
  - 통합 `calendar-view.tsx`: `CalEvent` → `{ id, title, kind: e.kind, start: e.start, end: e.end, status }`. feed가 이미 half-open이므로 `start`/`end` **그대로**(D14①). `tentative`→`status: "PENDING"` 매핑.
  - 연차 `leave-calendar.tsx`: `Ev` → `{ id, title: name + getFullLeaveText(...), kind: leaveType, status, ...allDayHalfOpen(startDate, endDate) }`. **`end`를 그대로 쓰지 말 것** — `time.ts`의 `allDayHalfOpen`으로 inclusive `endDate`를 half-open exclusive로 변환(D14②).

## 5. `CalendarMonth` 인터페이스 (개요)

> 정확한 시그니처·내부 구조는 plan/impl에서 확정. 여기서는 경계만 고정한다.

```ts
interface CalendarMonthProps {
  anchor: Date;                  // 표시할 월(KST 기준 정규화는 내부에서)
  events: CalendarEventInput[];
  intensity?: "soft" | "bold";   // 화면 단위 색강도(D3). 기본 "bold".
  now?: Date;                    // 과거/오늘 판정 기준(테스트 주입; 기본 new Date())
  legend?: boolean;              // 범례+필터 표시 여부(D12)
  onQuickAdd?: (dateKey: string) => void;          // 주입 시 hover/키보드 +(D9)
  renderDayDetail?: (ctx: DayDetailContext) => React.ReactNode; // 팝오버 내용(D8)
}
// DayDetailContext: { dateKey; iso; isPast; isToday; events: CalendarEventInput[] }
```

- 월 이동·"오늘"·로딩/에러/stale 표시는 **소비처가 자기 데이터 패칭과 함께 보유**(현재 두 파일이 각각 react-query로 패칭). `CalendarMonth`는 한 달의 그리드 렌더에 집중한다 — 데이터 패칭·월 네비게이션을 컴포넌트에 가두지 않는다(관심사 분리, 테스트 용이).
- 헤더(요일)·격자·팝오버·범례는 컴포넌트 내부.

## 6. lane packing (순수 함수)

`packWeekLanes(weekDays: GridDay[], events: CalendarEventInput[]): LaneRow[]`

- 입력: 한 주(7일)의 `GridDay`와 이벤트(half-open `[start, end)` instant — D14).
- 각 이벤트의 그 주 내 `[colStart, colEnd]`(1~7, KST 일자 기준)를 계산하고, 겹치지 않는 이벤트끼리 같은 lane에 배치(greedy interval packing).
- **마지막 점유 셀 = `end` 직전 날**(half-open exclusive 보정): 점유 일자는 `toKstDateKey(start)` ~ `toKstDateKey(end - 1ms)`. 자정 정각 경계에서 막대가 하루 초과/미달하지 않게 한다(D14). 단일일·`end` 생략은 시작 1칸.
- 주 경계로 잘린 이벤트는 `continuesLeft`/`continuesRight` 플래그(◂/▸).
- 한 셀 표시 가능 lane 수 초과 시 "+N 더보기"(팝오버에서 전체 노출).
- 순수 함수 → `tests/modules/calendar/lanes.test.ts`로 겹침·경계·정렬·overflow 케이스 단위 테스트.

## 7. 변경 대상 (Components)

| 파일 | 변경 |
| --- | --- |
| `src/modules/calendar/ui/calendar-month.tsx` | **신규** — 통일 월간 컴포넌트(소프트 카드·시간방향·기간막대·팝오버·범례·빠른추가·a11y). |
| `src/modules/calendar/ui/lanes.ts` | **신규** — `packWeekLanes` 순수 함수(D7). |
| `src/modules/calendar/ui/kind-styles.ts` | **신규** — kind→색(soft/bold) + status→오버레이 매핑 SSOT(D4/D5). 현 `KIND_CLASS` 이전. |
| `src/app/(app)/calendar/calendar-view.tsx` | `CalEvent`→`CalendarEventInput` 어댑터 + `CalendarMonth`(intensity=`bold`, 읽기전용 팝오버) 사용. 월 네비·feed 패칭·stale/실패 표시는 유지. 인라인 그리드/`KIND_CLASS` 제거. |
| `src/app/(app)/leave/_components/leave-calendar.tsx` | `Ev`→`CalendarEventInput` 어댑터 + `CalendarMonth`(intensity=`soft`, 종류별 색, 팝오버에 목록+신청, `canManage`면 `onQuickAdd`) 사용. 자체 그리드/`colorFor`/정적 범례/`leadBlanks` 제거. `CreateLeaveModal` 트리거는 팝오버/+에서. |
| `tests/modules/calendar/lanes.test.ts` | **신규** — lane packing 단위 테스트. |
| `tests/modules/calendar/calendar-month.test.tsx` | **신규** — soft/bold·status 오버레이·팝오버 open/Esc·빠른추가 노출 조건·범례 필터·a11y 렌더 테스트. |

기존 `grid.test.ts`·feed/leave API·`CreateLeaveModal`·라벨 헬퍼는 **무변경**. 어느 파일도 도메인 API 시그니처를 바꾸지 않는다.

## 8. 테스트 (TDD)

- `packWeekLanes`: 단일일/기간/겹침 2건→2 lane/주 경계 분할(◂▸)/overflow(+N)/정렬 안정성. **D14 경계**: ① all-day external(half-open exclusive end) 막대가 의도한 마지막 날까지만 채워짐(하루 초과 금지) ② 자정 정각 종료 이벤트가 다음 날을 점유하지 않음 ③ 연차 inclusive 범위(예 6/1~6/3)가 `allDayHalfOpen` 변환 후 정확히 3칸.
- **어댑터 정규화**(D14): 연차 `Ev`(inclusive endDate)·통합 `CalEvent`(half-open) 각각이 동일 날짜를 점유하도록 변환 결과를 검증(연차는 `allDayHalfOpen` 경유, 통합은 passthrough).
- `CalendarMonth`: ① `intensity` soft/bold 클래스 분기 ② status 오버레이(점선·취소선) ③ 과거/오늘/미래 시각 구분(`now` 주입) ④ 셀 클릭 → `renderDayDetail` 호출·팝오버 표시·Esc/바깥클릭 닫기 ⑤ `onQuickAdd` 미주입 시 + 미표시, 주입 시 표시·클릭 콜백 ⑥ 범례 토글 필터 ⑦ 키보드 포커스 이동·`role=dialog`.
- 회귀: `npm run lint`(boundaries 포함)·`typecheck`·`test`·`build` 모두 그린. 두 소비처가 기존과 동일 데이터로 렌더되는지(어댑터 정확성).

## 9. 수용 기준 (Acceptance Criteria)

1. 통합 캘린더·연차 캘린더가 **동일한 `CalendarMonth`**로 렌더되며 시각(소프트 카드·과거/오늘/미래)이 일치한다.
2. 기간 이벤트가 **연속 막대**로 보이고(주 경계 ◂/▸), 겹치면 lane으로 분리된다. **막대 길이가 정확하다**: 연차 inclusive 범위(예 6/1~6/3)는 3칸, all-day external(half-open exclusive)도 의도한 마지막 날까지만 — 하루 초과/미달 없음(D14).
3. 연차 캘린더에서 종류(연차/반차/반반차)가 **색으로**, 상태(대기/반려·취소)가 **오버레이로** 구분된다(D4/D5).
4. 셀 클릭 시 팝오버가 뜬다 — 통합은 읽기전용 상세, 연차는 목록 + (`canManage`) 신청 진입. Esc·바깥클릭으로 닫힌다.
5. 연차에서 기존 `+ 연차 입력`·`/leave/request?date=` 동선이 팝오버/빠른추가로 대체되고, 신청 제출 경로(`CreateLeaveModal`·도메인 트랜잭션)는 **동작 변화 없이** 작동한다.
6. 휴대폰 폭에서 그리드·기간 막대가 깨지지 않고, 키보드만으로 셀 이동·팝오버 열기/닫기가 된다.
7. `lint`/`typecheck`/`test`/`build` 모두 그린. 서버/도메인 코드 diff 없음(표현 계층 한정).

## 10. 배포 메모

- **스키마/마이그레이션 없음** → 표준 절차(build → `pm2 restart`). 비가역 마이그레이션 아님.
- 데이터·권한 무변경이므로 `db:seed` 재실행 불필요(표준 배포에 포함돼도 무해).
- dev 배포 smoke는 인증 후 **통합 캘린더(`/calendar`)·연차 캘린더(`/leave/calendar`) 양쪽 렌더 + 팝오버 + 연차 신청 1건**까지 확인(메모리 `dev-deploy-stale-build-p2010`: `/login` 200만으론 부족). 휴대폰 드래그/터치 smoke 시 `NEXTAUTH_URL` LAN→`100.66.58.66` 전환 필요(메모리 admin-ui 방향).
