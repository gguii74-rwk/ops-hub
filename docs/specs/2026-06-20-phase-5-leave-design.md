# Phase 5 — Leave 연차 도메인 포팅 설계

- Status: Draft
- Date: 2026-06-20
- Roadmap: `docs/product/modernization-roadmap.md` Phase 5 (Leave 포팅)
- Discovery: `docs/discovery/annual-leave-analysis.md`
- 선행: Phase 3(통합 캘린더) 머지 완료 — `calendar`가 `LeaveRequest`를 이미 출처로 읽는다(`["APPROVED","PENDING"]`). Phase 4(workflows 공통 기반)의 메일 인프라(`lib/integrations/mail`+`MailDelivery`)는 후속 메일 sub-project가 재사용한다.

## 1. 목표와 범위

`annual-leave` POC의 **연차 도메인 규칙과 데이터 모델만** ops-hub로 포팅한다(ADR-0001). Express 백엔드·JWT/localStorage 인증·SQLite·프론트 API URL 분기는 이식하지 않는다 — 인증은 NextAuth 세션, 권한은 access-control 권한 테이블, DB는 PostgreSQL, API는 same-origin Route Handler를 쓴다.

POC의 검증된 규칙(일수 계산·중복 금지·마이너스 허용·`usedDays` 캐시)은 **수정하지 않고 충실히 재현**하되, ops-hub 인프라가 제공하는 두 가지는 개선한다: (a) ANNUAL 일수에서 **공휴일도 제외**(영속 `Holiday` 저장소 도입), (b) `usedDays` 갱신을 트랜잭션 내 **atomic increment**로 동시성 강화 + 관리자 **`recalculate`** 정합성 작업 추가(discovery §3 권고).

### 포함 (핵심 도메인)

- `LeaveRequest` 신청·취소·내 목록·상세 (직원) + 관리자 직접입력·승인·반려·수정·삭제·대기목록
- `LeaveAllocation` 연도별 할당·요약·조정(이력)·`usedDays` 갱신·`recalculate`·전체 조회
- `LeaveAllocationHistory` 조정 이력
- 순수 도메인 규칙(`rules.ts`): 일수 계산(공휴일·주말 제외), 날짜 검증(직원/관리자), 유형별 검증, 중복 검사, 이월 만료 계산
- **영속 공휴일 인프라**: `Holiday` 모델 + `kernel/holidays` 공유 리더 + 정적 시드
- `/leave`(직원) + `/admin/leave/*`(관리자) UI, 권한 게이트
- access-control 권한 키 보강(seed-permissions)

### 비포함 (후속 sub-project)

- **메일 알림**(신청/승인/반려) — `lib/integrations/mail` + `MailDelivery`로 별도 포팅
- **연차 엑셀 리포트** — 별도 포팅
- 부서장/팀장 승인(부서-사용자 scope conditions) — 권한 키는 확장 가능하게 두되 정책은 중앙 ADMIN
- Google 공휴일 캘린더 → `Holiday` 자동 동기화(정적 시드로 충분, 후속 admin 액션 가능)
- calendar 모듈을 `Holiday` 리더로 전환(현재 Google 공휴일 소스 유지 — 손대지 않음)
- 데이터 마이그레이션(Phase 6)

## 2. 설계 결정 요약

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | POC 규칙을 **수정 없이 충실 포팅**, 구현만 ops-hub 계층으로 | "검증된 도메인 동작만 의도적으로 포팅"(ADR-0001). 규칙 변경은 별도 검토 |
| D2 | `usedDays`는 **캐시 필드 + 트랜잭션 atomic increment + recalculate** | 스키마가 캐시 필드 보유, 빠른 조회. read-then-write는 동시성 위험 → atomic 증감. 장애·수동수정 복구는 recalculate(discovery §3) |
| D3 | ANNUAL 일수에서 **공휴일도 제외**, 위해 **영속 `Holiday` 저장소** 신설 | 정확한 연차 일수. 휘발성 캐시(calendar Google 공휴일)는 범위키·TTL·Google 의존이라 **영구 저장값(저장되는 `days`)에 부적합** |
| D4 | 공휴일 조회는 `kernel/holidays` 공유 리더, **순수 `rules.ts`에 주입** | 모듈 경계(leave는 타 도메인 모듈 import 금지) 준수 + 규칙을 DB 없이 테스트 가능 |
| D5 | 승인 권한 = **중앙 ADMIN**(systemRole OWNER/ADMIN), 권한 키는 **MANAGER 부여 가능** 구조 | POC 충실(requireAdmin). ops-hub MANAGER 도입했으나 부서 scope는 후속. 키 메커니즘은 확장 여지 유지 |
| D6 | 캘린더 노출은 **Phase 3 그대로** — leave는 `LeaveRequest`만 올바로 기록 | calendar가 이미 `["APPROVED","PENDING"]` 읽고 dedup. 추가 작업 불필요 |

## 3. 모듈 구조와 경계

```
src/modules/leave/
  rules.ts                 # 순수 도메인 — DB 무관, 공휴일 Set 주입
                           #   calculateLeaveDays(type, start, end, holidays) / validateDates(직원) /
                           #   validateDatesForAdmin / validateLeaveTypeDates / calculateCarriedOverExpiry
  repositories/index.ts    # Prisma 직접 (leaveRequest / leaveAllocation / leaveAllocationHistory / user 조회)
  services/
    requests.ts            # 신청·취소·목록·상세 + 관리자 직접입력/승인/반려/수정/삭제
    allocations.ts         # 요약·조회·upsert·조정(이력)·recalculate·전체조회
  validations/index.ts     # zod 입력 스키마
src/kernel/holidays/       # 공유 공휴일 리더 (Holiday 모델 조회) — leave·calendar 공용 가능
  index.ts                 #   getHolidaysInRange(start, end): Promise<Set<string>>  (yyyy-MM-dd KST)
src/app/(app)/leave/       # 직원: 내 연차 요약 + 신청 + 이력
src/app/(app)/admin/leave/ # 관리자: 승인 대기 / 할당 관리
src/app/api/leave/         # route handlers (직원)
src/app/api/admin/leave/   # route handlers (관리자)
```

경계 규칙(eslint boundaries):

- `leave` 모듈은 `kernel`·`lib`·자기 모듈만 import. 타 도메인 모듈(`calendar`/`workflows`) import 금지.
- Prisma 접근은 `leave/repositories`(그리고 `kernel/holidays`)에서만.
- 공휴일은 `kernel/holidays`가 소유하는 공유 리더로 노출 → `leave`가 import(허용). `calendar`는 이번에 변경하지 않는다.
- 일수 계산은 `rules.ts`(순수). 공휴일 Set은 **service가 `kernel/holidays`에서 조회해 주입**한다 — `rules.ts`는 DB·외부 의존 없음.

## 4. 데이터 모델 변경

migration 1건. 기존 `LeaveRequest`/`LeaveAllocation`/`LeaveAllocationHistory`(Phase 1에 선반영)는 **변경하지 않는다**.

### 4.1 `Holiday` 신설 (schema `kernel` — 도메인 공유 참조 데이터)

```prisma
model Holiday {
  date      DateTime @id @db.Date   // 공휴일 1일 = 1행. 날짜 자체가 PK(중복 불가)
  name      String                  // "삼일절" 등
  year      Int                     // 조회·시드 편의(date에서 파생, 인덱스용)
  createdAt DateTime @default(now())

  @@index([year])
  @@schema("kernel")
}
```

- `@db.Date`로 시간대 잡음 제거(KST 자정 기준 1일 단위). `getHolidaysInRange`는 `yyyy-MM-dd` 문자열 Set으로 환원해 `rules.ts`에 넘긴다.
- 시드: `prisma/seed-holidays.ts`(또는 seed에 포함)로 한국 공휴일 정적 데이터를 적재(예: 2025–2027). 결정적·외부 의존 없음. 추후 Google 공휴일 동기화·연도 추가는 후속.

### 4.2 기존 leave 모델 (참고, 변경 없음)

- `LeaveAllocation(userId, year unique)`: `allocatedDays`/`carriedOverDays`/`carriedOverExpiryDate`/`usedDays`(캐시) — 전부 `Decimal(6,2)`.
- `LeaveRequest`: `leaveType`(ANNUAL/HALF/QUARTER)/`leaveSubType`(MORNING/AFTERNOON)/`quarterStartTime`/`startDate`/`endDate`/`days`/`status`(PENDING/APPROVED/REJECTED/CANCELLED)/`reviewedById`/`reviewedAt`/`rejectionReason`/`cancelledAt`/`cancellationReason`/`isCarriedOver`/`adminActionNote`.
- `LeaveAllocationHistory`: `changeType`(INITIAL/ADD/DEDUCT/CARRYOVER/ADJUSTMENT)/`changeDays`/`reason`/`reasonDetail`/`beforeDays`/`afterDays`/`createdById`.

## 5. 도메인 규칙 (`rules.ts` — POC 충실 포팅)

순수 함수. DB·시각·외부 의존 없음(현재 시각·공휴일 Set은 인자로 주입 → 결정적 테스트).

- **유형·일수** `calculateLeaveDays(type, start, end, holidays: Set<string>)`:
  - `ANNUAL` = start~end 사이 **주말(토·일) 및 공휴일 제외 일수**. (POC는 주말만 제외 → 본 포팅에서 공휴일 제외 추가, D3.)
  - `HALF` = 0.5, `QUARTER` = 0.25 (단일일).
- **날짜 검증**:
  - 직원 `validateDates(start, end, today)`: `start < today` 거부(과거 신청 불가), `start > end` 거부.
  - 관리자 `validateDatesForAdmin(start, end)`: `start > end`만 거부(과거 허용).
  - `validateLeaveTypeDates(type, start, end)`: HALF/QUARTER는 `start === end`(단일일)만 허용.
- **중복 금지**(서비스에서 검사): 같은 `userId`의 `PENDING`/`APPROVED` 신청과 기간 겹치면(`startDate <= newEnd && endDate >= newStart`) 거부.
- **마이너스 연차 허용**: 잔여 < 신청이어도 신청 생성(경고 로그만). POC 동작 유지 — 거부하지 않는다.
- **이월 만료** `calculateCarriedOverExpiry(year)`: 익년 6월 30일.
- 취소 가능 판정(서비스): 일반 사용자는 `startDate <= today`(당일·과거) 취소 불가. 관리자는 제한 없음.

## 6. 서비스 — `usedDays` 정합성 (불변식)

`usedDays`는 **승인분 캐시**다. 상태를 바꾸는 모든 경로는 트랜잭션으로 `LeaveRequest` 변경과 `usedDays` 증감을 **원자적으로** 처리한다. 증감은 read-then-write 대신 Prisma **atomic `increment`/`decrement`**(Decimal)로 동시성 경합을 피한다.

| 작업 | 가드 | 트랜잭션 내용 |
| --- | --- | --- |
| `approve` | status === PENDING (아니면 거부) | LeaveRequest → APPROVED + reviewedById/reviewedAt; allocation.usedDays **+= days** |
| `reject` | status === PENDING | LeaveRequest → REJECTED + reviewedById/rejectionReason. usedDays 변화 없음(미승인) |
| `cancel`(직원) | status ∈ {PENDING, APPROVED}; 직원은 `startDate <= today` 거부 | LeaveRequest → CANCELLED + cancelledAt/cancellationReason; **APPROVED였으면** usedDays **-= days** |
| `cancel`(관리자) | status ∈ {PENDING, APPROVED} | 위와 동일, 날짜 제한 없음 |
| `createByAdmin` | 과거 허용, 자동 APPROVED | LeaveRequest 생성(APPROVED); usedDays **+= days** |
| `updateByAdmin` | 대상 존재 | 기간/유형 변경 시 days 재계산; **이전 APPROVED days 차감 + 새 days 가산**(같은/교차 연도 처리); 검증·중복 재검사 |
| `deleteByAdmin` | 대상 존재 | LeaveRequest 삭제; **APPROVED였으면** usedDays -= days |

- `recalculate(userId, year)` (신규, admin): 해당 연도 `APPROVED` 합계로 `usedDays`를 재계산·확정. 장애·수동 DB 수정 후 캐시 정합성 복구.
- 할당 없는 사용자 승인/직접입력은 거부("할당 정보 없음") — POC 동작.

### 할당·요약·조정

- `getAllocationSummary(userId, year)`: `total = allocated + carriedOver`, `pendingDays = Σ(PENDING days in year)`, `remaining = total - usedDays - pendingDays`. 할당 없으면 null(UI는 "미설정" 표시).
- `createOrUpdateAllocation(userId, year, allocated, carriedOver, expiry)`: upsert.
- `adjustAllocation({userId, year, changeDays, changeType, reason, reasonDetail}, adminId)`: `allocatedDays += changeDays`(음수 결과 거부), `LeaveAllocationHistory` 기록(beforeDays/afterDays = 조정 전/후 잔여). 할당 없으면 0으로 생성 후 조정.
- `getAllocationHistory`, `getAllAllocations(year)`: 조회.

## 7. 공휴일 인프라 (`kernel/holidays`)

- `getHolidaysInRange(start: Date, end: Date): Promise<Set<string>>` — `Holiday`에서 범위 내 행을 읽어 `yyyy-MM-dd`(KST) 문자열 Set 반환. 빈 결과여도 정상(공휴일 없음).
- leave service가 신청·수정 시 대상 기간의 공휴일 Set을 조회해 `calculateLeaveDays`에 주입한다. `Holiday` 테이블은 시드로 항상 채워져 있어 **결정적**이다(휘발성 캐시 아님).
- `calendar`는 이번에 전환하지 않는다(Google 공휴일 소스 유지). 후속에 `getHolidaysInRange`로 통일 가능.

## 8. 권한·네비게이션 (access-control)

기존 catalog: 리소스 `leave.request`/`leave.approval`/`leave.allocation`. NAV `/leave`(`leave.request:view`) 시드됨. 권한은 `prisma/seed-roles.ts`의 `ROLE_ALLOW`(AccessRole 키 → `resource:action`)로 부여되고, `pm: ["*"]`(= OWNER systemRole)가 전부를 가진다. 작업자 role(regular-developer, contractor-developer/content/civil-response)은 이미 `leave.request:view`/`create`를 보유한다.

**catalog 보강:**

- `ACTIONS`에 **신설 `cancel`** 추가(본인 취소를 관리자 `update`와 구분).
- `EXTRA_PERMISSIONS`에 Permission 행 추가: `leave.request:cancel`/`update`/`delete`, `leave.approval:view`, `leave.allocation:view`. (`leave.request:view`/`create`, `leave.approval:approve`, `leave.allocation:configure`는 기존.)

**`ROLE_ALLOW` 부여:**

| 권한 키 | 용도 | 보유 |
| --- | --- | --- |
| `leave.request:view`/`create` | 내 요약·목록·상세·신청 | 작업자 role 전원 + pm(기존) |
| `leave.request:cancel` | 본인 신청 취소 | 작업자 role 전원에 **추가** + 본인 게이트 |
| `leave.request:update`/`delete` | 관리자 수정·삭제 | pm(`*`)/OWNER |
| `leave.approval:view`/`approve` | 대기목록·승인·반려 | pm(`*`)/OWNER |
| `leave.allocation:view`/`configure` | 할당 조회·설정·조정·recalculate | pm(`*`)/OWNER |

- 중앙 ADMIN 승인 = pm/OWNER가 담당(D5). 후속 부서장 승인은 별도 **MANAGER AccessRole에 `leave.approval:*`를 부여**해 확장(부서-사용자 scope conditions는 미도입).
- `cancel`·관리자 작업의 본인/대상 검증은 서비스에서 추가 게이트. UI `useCan` ↔ 서버 `requirePermission` 동일 키. fail-closed, OWNER 우회, deny 우선(access-control 규칙).

## 9. API 계약

모든 라우트 인증 필수. permission은 UI와 동일 키. 입력 검증 zod. 날짜는 calendar와 동일 KST 규약 재사용.

| 메서드·경로 | 동작 | 권한 |
| --- | --- | --- |
| `GET /api/leave/summary?year` | 내 연차 요약 | `leave.request:view` |
| `GET /api/leave/requests?year&status` | 내 신청 목록 | `leave.request:view` |
| `GET /api/leave/requests/[id]` | 내 신청 상세(본인) | `leave.request:view` + 본인 |
| `POST /api/leave/requests` | 신청 | `leave.request:create` |
| `POST /api/leave/requests/[id]/cancel` | 취소 | `leave.request:cancel` + 본인/admin |
| `GET /api/admin/leave/requests?status&userId` | 전체/대기 목록 | `leave.approval:view` |
| `POST /api/admin/leave/requests` | 관리자 직접입력(자동 APPROVED) | `leave.request:create`(admin) + `leave.approval:approve` |
| `POST /api/admin/leave/requests/[id]/approve` | 승인 | `leave.approval:approve` |
| `POST /api/admin/leave/requests/[id]/reject` | 반려(사유) | `leave.approval:approve` |
| `PATCH /api/admin/leave/requests/[id]` | 수정 | `leave.request:update` |
| `DELETE /api/admin/leave/requests/[id]` | 삭제 | `leave.request:delete` |
| `GET /api/admin/leave/allocations?year` | 할당 전체 조회 | `leave.allocation:view` |
| `PUT /api/admin/leave/allocations/[userId]/[year]` | 할당 설정 | `leave.allocation:configure` |
| `POST /api/admin/leave/allocations/[userId]/[year]/adjust` | 조정(이력) | `leave.allocation:configure` |
| `POST /api/admin/leave/allocations/[userId]/[year]/recalculate` | 사용일수 재계산 | `leave.allocation:configure` |
| `GET /api/admin/leave/allocations/[userId]/history?year` | 조정 이력 | `leave.allocation:view` |

- 이미 처리된 신청 재처리(승인된 걸 또 승인 등)는 409/거부(가드 §6).
- 동시 승인·취소 경합은 트랜잭션 + status 가드로 한쪽만 성공.

## 10. UI

ui 프리미티브·테마·React Query 재사용(Phase 3 패턴).

- `/leave`(직원):
  - 내 연차 요약 카드: 할당/이월/총/사용/대기/잔여 + 이월 만료일.
  - 신청 모달: 유형 선택(ANNUAL 기간 / HALF 오전·오후 / QUARTER 시작시각), 사유. 제출 시 일수 미리 표시(공휴일·주말 제외 반영).
  - 내 신청 이력: 상태 배지(PENDING/APPROVED/REJECTED/CANCELLED), 취소 버튼(가능 조건만).
- `/admin/leave/approvals`: 대기 목록(신청자·기간·유형·일수) + 승인/반려(사유).
- `/admin/leave/allocations`: 연도 선택 → 사용자별 할당 표(설정·조정), 조정 이력, `recalculate` 액션.
- 캘린더는 별도 페이지 없이 기존 `/calendar`(view=leave) 사용(Phase 3 통합 완료).
- seed에 데모 할당·신청 몇 건으로 화면 시연 가능하게 한다(dev 전용 seed-demo 확장).

## 11. 테스트 전략

TDD(실패 → 최소 구현 → PASS → commit). node 환경, DB·외부 없이. Prisma는 `vi.mock("@/lib/prisma")` in-memory fake(calendar/workflows 패턴).

- `rules`: 일수 계산(ANNUAL 주말+공휴일 제외 경계, HALF 0.5/QUARTER 0.25) / 직원 과거 거부·관리자 허용 / HALF·QUARTER 단일일 / 이월 만료일.
- 신청: 중복(PENDING/APPROVED 겹침) 거부 / 마이너스 허용(잔여 부족해도 생성) / HALF subType·QUARTER startTime 보존.
- `usedDays` 트랜잭션: approve += / reject 변화없음 / cancel(APPROVED) -= / cancel(PENDING) 변화없음 / createByAdmin += / updateByAdmin 교차연도 차감·가산 / deleteByAdmin -= / **동시 승인-취소 경합** status 가드.
- `recalculate`: APPROVED 합계로 usedDays 일치.
- 요약: remaining = total - used - pending(연도 경계 PENDING 합).
- 조정: allocatedDays 증감(음수 거부) + history before/after.
- `kernel/holidays`: 범위 조회가 yyyy-MM-dd Set, 빈 결과 정상.
- 권한·라우트: fail-closed(권한 없으면 거부), 본인 게이트(타인 신청 조회·취소 차단), zod 검증.

게이트(각 태스크 AC): `npm run typecheck` / `npm run lint` / `npm test` / `npm run build`. 스키마 변경은 §4 migration 1건 + 공휴일 시드.

## 12. 비목표·후속

- **메일 알림**(신청→관리자, 승인/반려→직원)은 비포함. POC는 `setImmediate` background. 후속에 `lib/integrations/mail` + `MailDelivery` 이력으로 포팅한다(업무 성공과 분리 — discovery §4).
- **엑셀 연차 리포트** 후속.
- **부서장 승인**: 권한 키는 MANAGER 부여 가능하나, 부서-사용자 매핑·scope conditions는 후속.
- **Holiday 자동 동기화**: 정적 시드로 운영하되, Google 공휴일 캘린더 → `Holiday` 동기화 admin 액션은 후속. `calendar`의 `Holiday` 리더 전환도 후속.
- **데이터 마이그레이션**(기존 운영 연차 데이터 적재·`usedDays` 정합성 검증 스크립트)은 Phase 6. 병합 키는 이메일.
- AI 서명 없는 commit(글로벌 규칙).
