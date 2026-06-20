# 연차 영역 재구성 + 원본 기능 완전 포팅 설계

- 날짜: 2026-06-20
- 상태: 설계 승인 대기 → 이후 `writing-plans-split`로 구현 계획 분할
- 선행: Phase 5 Leave(`2026-06-20-phase-5-leave-design.md`) — 도메인 백엔드·스키마·기본 신청 UI는 머지됨
- 원본 SSOT: `C:\workspace\annual-leave`(GitHub `gguii74-rwk/annual-leave`, `master` `7417510`)

## 1. 배경과 목표

Phase 5에서 연차 **도메인 백엔드(서비스·리포지토리·검증)와 스키마**는 옮겨졌으나, 원본 `annual-leave`가 제공하던 **사용자/관리자 화면 대부분이 빠졌다.** 현재 `/leave`는 "연차 현황 + 신청 폼 + 내 내역"만 있는 단일 얇은 페이지다.

목표: 원본의 화면과 기능을 ops-hub 구조(권한 모델·가로 탭·기존 leave 리포지토리)에 맞게 **그대로 포팅**한다. 대원칙은 **"기존 시스템의 기능을 그대로 옮긴다"** — 동작·규칙·시간대·표시 텍스트를 원본과 일치시킨다.

### 성공 기준(검증 가능)

- `/leave` 진입 시 권한에 맞는 **가로 탭**이 보이고, 각 탭이 원본과 동등하게 동작한다.
- 반반차 신청 시 **고정 6종 시간대 드롭다운**이 나오고, 저장·표시·종료시각 계산이 원본과 일치한다.
- 관리자가 **사용자를 선택해 직접 입력/수정/삭제**할 수 있고, 이메일 알림 옵션이 동작한다.
- 연차 전용 캘린더에서 **휴가만** 보이고, 부서/사용자 필터와 **날짜 클릭→신청**이 동작한다.
- 연차 현황을 **엑셀로 내보낼** 수 있다.
- 신청/승인/반려/직접입력 시 **알림 메일**이 background로 발송되고 `MailDelivery` 이력이 남는다.

## 2. 범위

### 포함

- 연차 영역 IA: 좌측 글로벌 네비의 "연차" 하위를 **상단 가로 탭**으로 재구성.
- 탭: 대시보드 / 연차 신청 / 연차 내역 / 연차 승인 / 연차 할당 / 연차 현황 / 캘린더. (권한별 노출)
- 신규 화면: 대시보드, 연차 현황(+엑셀), 전체 연차 내역(관리자), 연차 전용 캘린더, 관리자 직접입력·수정·삭제 모달.
- 신청 폼 보정: 반반차 시간대 6종 드롭다운, 반차 오전/오후(기존 유지).
- 신규 백엔드: dashboard 집계 service, 전체 현황 service, 엑셀 export route, 활성 사용자 목록 API, 메일 연결.
- 권한 seed 2종 추가.

### 제외 (non-goals)

- 계정 승인 / 사용자 관리 / 설정 화면 — 기존 admin 영역(접근제어·SystemSetting)에 그대로 둔다.
- 통합 캘린더(`/calendar`, `src/modules/calendar`) 변경 — 연차 전용 캘린더는 별도로 만들고 통합 캘린더는 건드리지 않는다.
- 부서장/팀장 승인 흐름(원본에도 없음). "팀" = `User.department` 문자열.

> 주의: 일부 필드는 추가가 필요하다 — 관리자 귀속 필드(`createdByAdminId/At`, `modifiedByAdminId/At`)는 현재 스키마에 **없으므로** Prisma migration이 생긴다(10절).

## 3. IA · 라우팅

좌측 글로벌 네비(대시보드/캘린더/워크플로우/**연차**/관리자)는 유지. "연차" 클릭 시 `/leave` 진입, 상단 **가로 탭**으로 하위 전환. App Router 세그먼트로 구성하여 탭별 서버 권한 가드·딥링크·새로고침 복원을 보장한다.

| 경로 | 탭 라벨 | 진입 권한(서버 `requirePermission`) | 비고 |
| --- | --- | --- | --- |
| `/leave` | 대시보드 | `leave.request:view` | 일반=내 요약, 관리자=전체 통계 |
| `/leave/request` | 연차 신청 | `leave.request:create` | 사용자 신청 폼 |
| `/leave/history` | 연차 내역 | `leave.request:view` | 일반=내 이력 / 관리자=전체(`leave.admin:view` 보유 시) |
| `/leave/calendar` | 캘린더 | `leave.request:view` | 연차 전용 |
| `/leave/approvals` | 연차 승인 | `leave.approval:view` | 관리자 |
| `/leave/allocations` | 연차 할당 | `leave.allocation:view` | 관리자 |
| `/leave/status` | 연차 현황 | `leave.status:view` | 관리자, 엑셀 |

규칙(access-control 준수):

- 탭 바는 `src/app/(app)/leave/layout.tsx`에서 권한 요약(`useCan`)으로 **노출 필터**.
- 각 페이지(서버 컴포넌트)는 진입 시 `requirePermission(...)`으로 **이중 가드**. 메뉴 숨김은 UX일 뿐, 라우트·API가 같은 키를 검사한다.
- 권한 부족 시 fail-closed(접근 거부 메시지 또는 대시보드로).

## 4. 권한 모델 (seed 추가)

기존: `leave.request`(create/cancel/update/delete/**view**), `leave.approval`(view/approve), `leave.allocation`(view/configure).

신규 2종(`prisma/seed-permissions.ts`):

- `leave.status` : `view` — 전체 직원 연차 현황 조회·엑셀 내보내기.
- `leave.admin` : `view` — 전체(타인 포함) 연차 신청 내역 조회.

**전체 이력 권한 경계(일관성 — 적대검증 finding 반영):** 전체(타인 포함) 신청 내역 조회는 `leave.admin:view`를 **단일 canonical 권한**으로 쓴다. 현재 `GET /api/admin/leave/requests`는 `leave.approval:view`로 가드돼 있으나, 승인 화면(승인 대기 처리)과 전체 이력은 청중이 다르므로 분리한다:

- 승인 대기 조회·승인/반려: `leave.approval:view`/`approve` (기존 유지).
- 전체 이력 조회(모든 사용자·모든 상태, 필터): `GET /api/admin/leave/requests`의 **GET 핸들러 가드를 `leave.approval:view` → `leave.admin:view`로 변경**(POST 직접입력은 `leave.approval:approve` 유지). page·route·service·test 모두 이 키로 일관 적용. 승인 화면이 전용 목록을 쓰면 승인 대기 전용 라우트를 별도로 둔다.

대시보드: 진입은 `leave.request:view`로 공통. **관리자 통계 블록**(전체 인원·오늘 휴가중·대기·오늘/내일/차주 휴가자)은 `leave.approval:view` 보유 시 추가 렌더. 일반 사용자는 본인 요약만.

> `leave.request:view` 키 존재 여부를 구현 착수 시 확인한다(현재 페이지 코드가 사용 중이나 seed 목록 head에 안 보였음). 없으면 seed에 포함한다.

## 5. 도메인 규칙 — 반차/반반차 (원본 SSOT 그대로)

원본 `frontend/src/lib/utils.ts`의 로직을 ops-hub로 포팅한다. ops-hub 스키마에 필드는 이미 존재(`leaveSubType: LeaveSubType?`(MORNING/AFTERNOON), `quarterStartTime: String?`).

### 반차(HALF) — 0.5일

- 세부유형 `leaveSubType`: `MORNING`(오전 반차) / `AFTERNOON`(오후 반차).
- 표시: 오전 반차 / 오후 반차. (표시 참고: 오전 09:00~13:00, 오후 14:00~18:00)
- 단일일만 허용(`validateLeaveTypeDates` 기존 규칙).

### 반반차(QUARTER) — 0.25일

`quarterStartTime`(시작시각 HH:MM)에 아래 **6종 중 하나만** 저장. 종료시각은 파생 계산.

| 시작(`quarterStartTime`) | 종료 | 라벨 |
| --- | --- | --- |
| `09:00` | 11:00 | 09:00 ~ 11:00 |
| `10:00` | 12:00 | 10:00 ~ 12:00 |
| `11:00` | 14:00 | 11:00 ~ 14:00 (점심 포함) |
| `13:00` | 15:00 | 13:00 ~ 15:00 |
| `15:00` | 17:00 | 15:00 ~ 17:00 |
| `16:00` | 18:00 | 16:00 ~ 18:00 |

종료시각 계산(`getQuarterEndTime` 포팅): `11`시 → `14:00`, 그 외 → 시작+2시간. 단일일만 허용.

### 포팅할 표시 헬퍼 (원본 `utils.ts`)

- `getLeaveTypeText`(ANNUAL/HALF/QUARTER → 연차/반차/반반차)
- `getLeaveSubTypeText`(MORNING/AFTERNOON → 오전 반차/오후 반차)
- `getQuarterTimeText`(start → "start~end"), `getQuarterEndTime`
- `getFullLeaveText`(유형+세부 → "반반차 09:00~11:00" 등)

배치: `src/modules/leave/labels.ts`(또는 기존 `src/app/(app)/leave/labels.ts`)에 통합. 시간대 6종은 코드 상수 `QUARTER_TIME_SLOTS`로 단일 정의(폼·검증·표시 공유).

### 검증

- `createLeaveSchema.quarterStartTime`을 정규식(`^\d{2}:\d{2}$`)에서 **6종 화이트리스트**로 강화(`z.enum([...])` 또는 refine).
- `leaveType === "QUARTER"`면 `quarterStartTime` 필수, `HALF`면 `leaveSubType` 필수. 서버·클라이언트 모두 검증.

## 6. 화면별 명세

원본 화면을 기준으로 한다. 표시·필터·컬럼을 원본과 일치시킨다.

### 6.1 대시보드 (`/leave`)

- 일반: 카드 4종(총·사용·대기·잔여) + 사용률 진행바(% + n/총) + 이월 안내("이월 연차 N일이 있습니다") + 최근 신청 내역(최근 5건, "전체 보기"→`/leave/history`).
- 관리자(권한 보유): 위 + 전체 통계 카드(전체 인원·오늘 연차 사용 중·대기 중 신청) + 오늘/내일/차주 연차 사용자 목록.
- 백엔드: 신규 `src/modules/leave/services/dashboard.ts` — 원본 `dashboard.service.ts`의 `getEmployeeDashboard`/`getAdminDashboard` 포팅. API `GET /api/leave/dashboard`(세션 사용자 기준, 권한 따라 응답 확장).

### 6.2 연차 신청 (`/leave/request`)

- Image 10 형태: 잔여 연차 요약 카드 + 유형 버튼 3개(연차/반차/반반차) + (반차→오전/오후, 반반차→시간대 6종) + 시작/종료일(반차·반반차는 단일일) + 사유(0/500자).
- 쿼리 `?date=YYYY-MM-DD` prefill(캘린더 날짜 클릭 연동).
- 기존 `leave-request-form.tsx`를 이 명세로 보정(특히 반반차 `type=time` → 6종 select).

### 6.3 연차 내역 (`/leave/history`)

- 일반: "내 연차 내역" — 상태 탭(전체/대기중/승인됨/반려됨/취소됨), 카드 리스트(유형·기간·신청일·사유·처리일), 관리자 등록/수정 뱃지(`createdByAdminId`/`adminActionNote` 등).
- 관리자(`leave.admin:view`): "연차 신청 내역" — 년/월/상태/검색(이름·부서) 필터, 전체 사용자 카드 리스트(이름·부서·상태 뱃지). 행에서 수정/삭제 모달 진입.
- API: 기존 `GET /api/leave/requests`(본인) + `GET /api/admin/leave/requests`(전체). 전체 조회 GET은 **`leave.admin:view`로 가드**(4절), 필터 파라미터(년/월/상태/이름·부서 검색) 확장.

### 6.4 연차 승인 (`/leave/approvals`)

- 관리자: 승인 대기 목록 → 승인/반려(반려 사유). 기존 approve/reject API 사용. 원본 `admin/approval` 포팅.

### 6.5 연차 할당 (`/leave/allocations`)

- 관리자: 연도 네비(이전/현재/다음) + 사용자별 표(이름·부서·할당·사용·잔여) + "조정"(추가/차감·일수·사유·상세) 모달 + "신규 연차 할당". 기존 allocation API·`allocations-client.tsx` 재사용/확장.

### 6.6 연차 현황 (`/leave/status`)

- 관리자: 전체 직원 표(이름·이메일·부서·총·사용·대기·잔여), 부서 필터·이름 검색, 잔여 색상 강조 + **엑셀 내보내기**.
- 백엔드: 신규 `getAllEmployeesStatus`(원본 포팅) → `GET /api/admin/leave/status`. 엑셀 `GET /api/admin/leave/status/export`(`exceljs`).

### 6.7 캘린더 (`/leave/calendar`) — 연차 전용

- `LeaveRequest` 직접 조회(기존 `leave/repositories`). 월간 그리드 + 월 이동(이전/다음/오늘).
- 범례·색상: 연차(파랑)/반차(초록)/반반차(보라)/대기중(노랑)/반려됨(회색). 셀에 "이름 + 유형" 표기.
- 일반: 본인 + **같은 부서** 직원. **부서(`department`)가 null·빈값·신뢰 불가면 본인 일정만(self-only) fail-closed** — null끼리 묶여 무관한 사용자의 이름·날짜·유형이 노출되지 않게 한다(적대검증 finding 반영). 부서 필터는 서버측에서 강제(클라이언트 신뢰 금지). 권한 없는 타인의 사유·세부는 마스킹(제목만). 날짜 클릭 → `/leave/request?date=` 이동.
- 관리자: **부서/사용자 필터** + "+ 연차 입력"(직접입력 모달, 날짜 prefill).
- 통합 캘린더(`/calendar`)와 독립.

## 7. 관리자 모달 (직접입력/수정/삭제)

원본 `CreateLeaveModal`/`EditLeaveModal` 포팅. 백엔드는 대부분 존재(`adminCreateLeaveSchema`+`createLeaveRequestByAdmin`, `updateLeaveSchema`+PATCH, DELETE). **단, 관리자 귀속 필드(`createdByAdminId/At`·`modifiedByAdminId/At`)는 스키마에 없으므로 추가가 선행되어야 한다(10절). 현재 직접입력 service가 `reviewedById`에 접어 기록하는 부분을 신규 필드로 분리한다.**

### 직접입력 (Create) — Image 9

- 필드: **사용자 선택 드롭다운**(`이름 - 부서 (이메일)`), 연차 유형, (반차→오전/오후, 반반차→시간대 6종), 시작/종료일, 사유, **"사용자에게 이메일 알림 발송" 체크박스**(`sendNotification`).
- 자동 승인(권한 `leave.approval:approve`). 등록 시 `createdByAdminId/At` 기록.
- 신규 API: `GET /api/admin/leave/users` — 활성 사용자 목록(id·name·department·email). 권한 `leave.approval:view`.

### 수정 (Edit)

- 기존 신청을 유형/세부/날짜/사유 수정. `modifiedByAdminId/At`·`adminActionNote`("사유: 시간 변경" 등) 기록. PATCH `/api/admin/leave/requests/[id]`.
- 사용일수 변동 시 `LeaveAllocation.usedDays` 재계산은 transaction(기존 불변식 준수).

### 삭제 (Delete)

- 확인 모달 후 DELETE. usedDays 재계산 transaction.

## 8. 메일 알림

시점·수신자: 신청(관리자 통지) / 승인·반려(신청자 통지) / 관리자 직접입력(`sendNotification` 체크 시 신청자 통지).

**전달 모델(확정 — outbox 패턴):** 기존 `MailDelivery`(workflows 스키마)를 연차 알림까지 수용하도록 **확장**한다(CLAUDE.md "연차 메일도 MailDelivery 이력" 규약). leave 전용 테이블은 두지 않는다.

- 추가 필드(10절 migration): `leaveRequestId String?`(relation 없이 id만 저장 — cross-schema 결합 회피), `eventType String?`(REQUESTED / APPROVED / REJECTED / ADMIN_CREATED), `attempts Int @default(0)`. 제약 **`@@unique([leaveRequestId, eventType])`** — 연차 이벤트당 행 1개(중복 발송 원천 차단).
- 상태: `MailDeliveryStatus`에 **`PENDING` 추가**(현재 SENDING/SENT/FAILED). 전이 `PENDING → SENDING → SENT | FAILED`.

**트랜잭션 계약:** 연차 작업(신청/승인/반려/직접입력) transaction **내부**에서 `MailDelivery` 행을 `PENDING`으로 insert. unique 제약 충돌(이미 존재)은 조용히 무시(idempotent insert). 커밋이 곧 "발송 예약"의 durable 기록 — 커밋 후 프로세스가 죽어도 행이 남는다.

**worker 계약(소유권·재시도):** 커밋 후 background worker가 `PENDING`(및 `FAILED && attempts < N`) 행을 집는다. 집을 때 **조건부 update(`PENDING → SENDING`, 영향 행 0이면 다른 worker가 선점 → skip)**로 단일 처리/동시성 보호. SMTP 성공 → `SENT`(+`providerMessageId`·`sentAt`), 실패 → `FAILED`(+`errorMessage`·`attempts++`). 재시도 대상은 `FAILED && attempts < N`.

**불변식:** 발송 실패·worker 지연이 연차 신청/승인 트랜잭션을 깨지 않는다(연차 도메인 불변식). 직접입력은 `sendNotification` 체크 시에만 행 생성.

본문: 원본 `email.service.ts` 템플릿 참고, ops-hub 발송기 형식에 맞춤.

## 9. 엑셀 내보내기

- `exceljs`(이미 의존성) 사용. 연차 현황 표를 시트로: 이름·이메일·부서·총·사용·대기·잔여.
- 라우트 `GET /api/admin/leave/status/export` — `Content-Disposition` 첨부, 파일명 `leave-status-YYYY.xlsx`. 권한 `leave.status:view`.
- 원본 `excel.service.ts` 컬럼 구성을 따른다.

## 10. 데이터 · 마이그레이션 영향

- **이미 존재(변경 불필요):** `LeaveRequest.leaveSubType`(MORNING/AFTERNOON)·`quarterStartTime`·`adminActionNote`·`isCarriedOver`·`reviewedById`, `User.department`, `LeaveAllocation*`.
- **신규 필드 + Prisma migration 필요(적대검증 finding — 관리자 귀속):** 현재 `LeaveRequest`에는 `reviewedById`/`adminActionNote`만 있고 **`createdByAdminId/At`·`modifiedByAdminId/At`가 없다.** 원본(`annual-leave`)은 이 4개 필드로 관리자 등록/수정 뱃지·감사를 처리한다. "기존 그대로 포팅" 원칙에 따라 동일 필드를 추가하고 migration을 생성한다.
  - 추가: `createdByAdminId String?`, `createdByAdminAt DateTime?`, `modifiedByAdminId String?`, `modifiedByAdminAt DateTime?`.
  - 직접입력 service가 현재 `reviewedById`에 접어 기록하는 부분을 `createdByAdminId/At`로 분리, 수정 시 `modifiedByAdminId/At` 기록.
- **메일 outbox(8절) — 확정:** `MailDelivery`(workflows 스키마) 필드 추가 migration — `leaveRequestId String?`, `eventType String?`, `attempts Int @default(0)`, `@@unique([leaveRequestId, eventType])`. `MailDeliveryStatus`에 `PENDING` 추가(현재 SENDING/SENT/FAILED).
- 권한 seed 2종 추가(`leave.status`·`leave.admin`).
- 시간대 6종은 **코드 상수**(DB 아님).

## 11. 컴포넌트 · 파일 구조

```
src/app/(app)/leave/
  layout.tsx                 # 가로 탭 바(권한 필터) + 공통 헤더
  page.tsx                   # 대시보드
  request/page.tsx           # 신청(폼 컴포넌트 보정)
  history/page.tsx           # 내역(일반/관리자 분기)
  calendar/page.tsx          # 연차 전용 캘린더
  approvals/page.tsx         # 승인
  allocations/page.tsx       # 할당(기존 이동/재사용)
  status/page.tsx            # 현황 + 엑셀
  _components/               # LeaveCalendar, CreateLeaveModal, EditLeaveModal, UserSelect 등
src/modules/leave/
  services/dashboard.ts      # 신규
  services/status.ts         # 신규(전체 현황)
  labels.ts                  # 표시 헬퍼 + QUARTER_TIME_SLOTS 상수
src/app/api/leave/dashboard/route.ts            # 신규
src/app/api/admin/leave/users/route.ts          # 신규(사용자 목록)
src/app/api/admin/leave/status/route.ts         # 신규
src/app/api/admin/leave/status/export/route.ts  # 신규(엑셀)
prisma/seed-permissions.ts                        # 권한 2종 추가
```

기존 `admin/leave/approvals`·`admin/leave/allocations` 화면은 `/leave/*` 탭으로 이동하거나, 라우트를 유지하되 탭에서 링크/재사용한다(구현 계획에서 확정).

## 12. 에러 처리 · 부분 실패

- 권한 부족: fail-closed. 서버 가드에서 403/리다이렉트.
- 메일 발송 실패: 신청·승인 성공에 영향 없음. `MailDelivery`에 실패 이력.
- usedDays 정합성: 승인/취소/수정/삭제는 transaction. 기존 `recalculate` 작업 유지.
- 캘린더: 데이터 조회 실패가 페이지 전체를 막지 않도록(빈 상태·에러 표시).

## 13. 테스트 전략 (vitest, `src` 미러)

- 시간대: `getQuarterEndTime` 6종 + 11시 점심 케이스, `getQuarterTimeText`/`getFullLeaveText`.
- 검증: 반반차 화이트리스트(6종 외 거부), QUARTER↔quarterStartTime/HALF↔leaveSubType 필수 규칙.
- 권한: 각 탭 라우트 fail-closed, `leave.status`/`leave.admin` 키 가드.
- 대시보드 집계: 사용률·이월·최근 5건, 관리자 통계 카운트.
- 현황/엑셀: 행 수·컬럼.
- 캘린더 마스킹: 권한 없는 타인 사유 가림. **부서 null·빈값·cross-department → self-only fail-closed**(finding).
- 직접입력: 사용자 선택·자동승인·알림 옵션, 수정 시 usedDays 재계산.
- 관리자 귀속(finding): 직접입력 시 `createdByAdminId/At` 기록·뱃지, 수정 시 `modifiedByAdminId/At` 기록.
- 권한 경계(finding): 전체 이력 GET이 `leave.admin:view`로 가드돼 `leave.approval:view`만으론 차단되는지, 승인 라우트는 `approval` 키로 동작하는지.
- 메일 idempotency(finding): 같은 `leaveRequestId`+`eventType` 중복 발송 방지, 커밋 후 프로세스 실패 시 재시도(PENDING 잔존 → 재발송), 발송 실패가 업무 트랜잭션을 깨지 않음.

## 14. 결정된 사항(확정)

- IA: 상단 가로 탭(좌측 1단 유지).
- "팀" = `User.department`.
- 사용자 대시보드 포함.
- 계정승인·사용자관리·설정은 연차 영역 밖(기존 admin).
- 캘린더: 연차 전용 신규(통합 feed 재사용 안 함).
- 반반차: 고정 6종 시간대(원본 SSOT). 관리자 직접입력 시 사용자 선택 + 이메일 알림 옵션.
- 대원칙: 원본 기능을 그대로 포팅.

## 15. 미해결(구현 착수 시 확인)

- `leave.request:view` 키가 seed에 실재하는지 확인, 없으면 추가.
- 기존 `admin/leave/*` 라우트를 `/leave/*`로 이전할지 링크 재사용할지(파일 이동 범위) — 구현 계획에서 확정.
- 관리자 통지 메일의 수신자(관리자 그룹) 정의 — 원본 `email.service.ts`와 ops-hub 설정 대조.
- worker 재시도 상한 `N`과 worker 구동 방식(요청 시 트리거 vs 주기 실행)의 구체값 — 구현 계획에서 확정(8절 계약은 고정).
