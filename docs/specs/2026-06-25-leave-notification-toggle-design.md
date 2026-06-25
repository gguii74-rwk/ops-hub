# 연차 알림 메일 발송 토글 + 설정 메뉴 노출

- 날짜: 2026-06-25
- 범위: 설정 체계(`kernel/settings`) + 연차 서비스 게이트 + 표현계층(설정 에디터·메뉴). **Prisma 마이그레이션 없음**(SystemSetting 테이블은 임의 키를 받음).

## 배경 / 문제

연차 도메인은 4개 이벤트에서 알림 메일을 발송한다 — 신청(`createLeaveRequest`→승인권자), 승인(`approve`→신청자), 반려(`reject`→신청자), 관리자 직접등록(`createLeaveRequestByAdmin`→대상자). 이 중 관리자등록만 호출 인자 `sendNotification`으로 건별 제어되고, **신청·승인·반려 3개는 SMTP가 설정돼 있고 수신자가 있으면 무조건 발송**된다.

운영자가 알림 메일을 켜고 끌 수 있는 화면·설정이 **어디에도 없다**. 더해, 설정 화면(`/admin/settings`, 권한 `admin.settings:view`)은 존재하고 정상 동작하지만 사이드바 "관리" 메뉴 트리(`NAV`)에 **설정 항목만 누락**되어 URL 직접 입력으로만 닿는다(사용자 관리·팀·권한·메뉴 항목은 모두 등록됨).

## 목표

1. **연차 알림 메일을 이벤트별로 켜고 끈다** — 신청/승인/반려 각각 독립 토글. 관리자가 설정 화면에서 체크박스로 조작한다.
2. **설정 메뉴를 사이드바에 노출** — "관리" 하위에 "설정" 항목 추가.

비목표: 관리자 직접등록 알림(`createLeaveRequestByAdmin`)은 기존 `sendNotification` 건별 제어를 그대로 둔다(토글 대상 아님 — D3). 메일 enqueue 구조·발송 워커(`drainLeaveMailOutbox`)·수신자 결정 로직은 변경하지 않는다.

## 결정(브레인스토밍 확정 — codex 적대검증 시 버그로 재지목 금지)

- **D1. 토글 단위 = 이벤트별 3개.** 전역 마스터/그룹 2개가 아니라 신청·승인·반려 개별. 운영 유연성(예: 결과 메일은 켜고 신청 알림만 끄기).
- **D2. OFF면 미발송 이력을 남기지 않는다.** OFF 시 `MailDelivery` outbox에 아예 적재하지 않는다(SKIPPED 상태 신설·enum 추가 안 함 → workflow 소비자·마이그레이션 영향 없음).
- **D3. 관리자 직접등록은 토글 대상에서 제외.** 이미 `sendNotification`으로 건별 제어되므로 중복 게이트를 만들지 않는다.
- **D4. 기본값 ON, 폴백 ON.** 기존 동작(무조건 발송) 보존을 위해 `default: true`. 설정 조회 실패 시에도 발송(`fallbackSafe: true`) — 알림 누락보다 발송이 운영상 덜 위험.
- **D5. 설정 키 = 개별 boolean 3키.** 객체 1키가 아니라 catalog의 SMTP(host/port/fromAddress) 개별 키 패턴을 따른다 — 설정 화면이 키별 title/description을 노출해 관리자가 각 토글을 이해하기 쉽다.

## 설계

### 1. 설정 카탈로그 — `src/kernel/settings/catalog.ts`

새 카테고리 **"leave"(연차)** 아래 `systemSetting` 3키 추가:

| 키 | title | description |
| --- | --- | --- |
| `leave.notifications.onRequest` | 연차 신청 알림 메일 | 직원이 연차를 신청하면 승인 권한자에게 알림 메일을 보냅니다. |
| `leave.notifications.onApprove` | 연차 승인 알림 메일 | 연차가 승인되면 신청자 본인에게 알림 메일을 보냅니다. |
| `leave.notifications.onReject` | 연차 반려 알림 메일 | 연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다. |

공통 필드: `kind: "systemSetting"`, `category: "leave"`, `schema: z.boolean()`, `default: true`, `audit: "summary"`, `fallbackSafe: true`, `permission: { resource: "admin.settings", action: "configure" }`. `order`는 기존 워크플로(40번대) 다음 50/51/52.

`SYSTEM_KEYS`는 `CATALOG`에서 파생되므로 자동 포함된다.

### 2. 설정 타입·화면 — `registry.ts` / `settings/page.tsx`

- `registry.ts`: `SettingCategory` union에 `"leave"` 추가.
- `settings/page.tsx`: `CATEGORY_LABELS`에 `leave: "연차"`, `CATEGORY_ORDER`에 `"leave"`(워크플로 다음) 추가. 기존 렌더 루프가 카테고리별 Card를 자동 생성한다.

### 3. 설정 에디터 boolean 분기 — `settings/settings-editor.tsx`

현재 `SettingEditor`는 raw JSON textarea다. `initialValue`가 `typeof === "boolean"`이면 **체크박스 UI**를 렌더:

- 체크박스 + 라벨(켜짐/꺼짐). **변경 즉시** 동일 `PUT /api/admin/settings/[key]`로 `value: boolean`·`expectedUpdatedAt: token` 전송(별도 저장 버튼 없음 — 토글 UX) — 낙관적 락 토큰 흐름과 409/422 처리 그대로, 저장 중 비활성화. 실패 시 토스트 + 이전 상태 롤백.
- boolean 외 값은 기존 textarea 경로 유지(회귀 없음).
- UI 프리미티브: 기존 `@/components/ui`에 Checkbox/Switch가 있으면 재사용, 없으면 native `<input type="checkbox">`로 최소 구현(프리미티브 신설은 비목표).

### 4. 서비스 게이트 — `src/modules/leave/services/requests.ts` (repository 무변경)

repository의 `createPendingRequest`/`approveTx`/`rejectRequest`는 **이미 `mailJob?: MailJob | null`을 받아 `if (mailJob)`일 때만 `insertPendingDelivery`** 한다. 따라서 서비스에서 토글 OFF 시 `mailJob`을 만들지 않고 `null`을 넘기면 enqueue가 자동 스킵된다 — repository·트랜잭션 변경 불필요.

`getSetting`(`@/kernel/settings/reader` facade — 모듈 경계 허용)으로 enqueue 직전 검사:

- `createLeaveRequest`: `await getSetting("leave.notifications.onRequest")`가 false면 `mailJob` 미생성, `createPendingRequest(..., null)` 전달. `triggerLeaveMailDrain()`은 **mailJob이 있을 때만** 호출(불필요 drain 방지 — 단 호출돼도 무해).
- `approve`: `onApprove` false면 `mailJob = null`.
- `reject`: `onReject` false면 `mailJob = null`.
- `createLeaveRequestByAdmin`: **변경 없음**(D3).

`getSetting`의 타입은 `JsonValue`이므로 boolean 단정/비교는 `=== false` 또는 `!== true` 중 **명시적 비교**로 처리(폴백 기본값이 ON이므로 "명시적 false일 때만 끈다").

### 5. 메뉴 노출 — `src/kernel/access/catalog.ts`의 `NAV`

`admin` children 끝에 추가:

```
{ key: "admin-settings", label: "설정", href: "/admin/settings", permission: "admin.settings:view" }
```

`seedNavigation`은 create-if-absent이라 재시드 시 기존 트리에 신규 자식만 추가한다. `admin`은 top-level이므로 자식 추가가 depth-3 위반에 걸리지 않는다. `sortOrder`는 형제 인덱스 기반이라 마지막에 붙는다(메뉴 관리 화면에서 관리자가 재정렬 가능 — DB가 진실원 D3). **배포 시 `npm run db:seed` 필요**(신규 nav 항목 등록).

## 불변식 / 영향

- 연차 도메인 불변식과 **무관**: `usedDays` 캐시·status-CAS 트랜잭션·할당 차감은 그대로. 이번 변경은 **메일 enqueue의 조건부 스킵**과 표현계층(에디터·메뉴)뿐.
- 발송 시점 권한 재확정(REQUESTED를 drain이 `getLeaveAdminRecipients`로 재확정하는 SSOT)은 불변 — 토글은 **enqueue 시점 게이트**이고, 권한 경계는 발송 시점 게이트로 직교한다.
- REQUESTED "수신자 0명이어도 durable 적재"(phase-5 spec §8)와의 관계: 그 규칙은 "보내려 했으나 수신자가 없다"는 운영 가시성을 위한 것이다. 토글 OFF는 "보내지 않기로 한 명시적 결정"이므로 durable 적재 대상이 아니다(D2와 일관).
- Prisma 마이그레이션 없음 → 표준 restart 배포. 단 메뉴 노출은 `db:seed` 재실행으로 nav 항목을 등록해야 반영된다.
- 권한: 토글 조작은 `admin.settings:configure`(기존 설정 쓰기 권한), 설정 화면 진입은 `admin.settings:view`. 신규 권한 없음.

## 테스트

- `tests/kernel/settings/catalog.test.ts`(또는 기존 catalog 테스트): 3키 존재, `default === true`, `z.boolean()` 파싱(true/false 통과, 비boolean reject), `category === "leave"`.
- `tests/modules/leave/services/requests.test.ts`: 각 이벤트별로 토글 ON→`insertPendingDelivery` 호출(mailJob 전달), OFF→미호출(null 전달). `getSetting` 모킹. 관리자등록은 토글 무관·`sendNotification`만 따름을 확인(회귀 가드).
- `tests/kernel/access/catalog.test.ts`(NAV 테스트): `admin` children에 `admin-settings` 포함, href·permission 일치.
- `tests/app/admin/settings-editor.test.tsx`: boolean `initialValue` → 체크박스 렌더, 토글 시 PUT 호출 body(`value: boolean`). 비boolean → textarea 유지.
