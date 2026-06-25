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
- **D4. 기본값 ON(미설정), 읽기 실패는 fail-closed.** 설정이 없으면(미설정 행) 또는 저장값이 무효면 catalog `default: true`로 ON — 기존 동작(무조건 발송) 보존(`fallbackSafe: true` 유지: 무효 저장값 → default ON 폴백). 단 설정 **조회가 예외로 실패(인프라 장애·`UnknownSettingError` 등)** 하면 **미발송(fail-closed)** — 서비스 헬퍼가 예외를 catch해 `false` 반환. (애초 fail-open이었으나 codex 적대검증 2회 no-ship 지적 → 2026-06-25 사용자 결정으로 "읽기 실패만 fail-closed"로 개정. "미설정 행 → ON"과 "조회 예외 → 미발송"은 별개 경로.)
- **D5. 설정 키 = 개별 boolean 3키.** 객체 1키가 아니라 catalog의 SMTP(host/port/fromAddress) 개별 키 패턴을 따른다 — 설정 화면이 키별 title/description을 노출해 관리자가 각 토글을 이해하기 쉽다.
- **D6. 토글 쓰기 권한 = `leave.admin:configure`(도메인 스코프).** (codex 적대검증 R3 지적 → 2026-06-25 사용자 결정.) 애초 generic `admin.settings:configure`를 쓰려 했으나, 기존 도메인 설정은 모두 도메인 스코프 configure(`integrations.smtp:configure`·`workflows.weekly:configure` 등)를 entry 권한으로 쓴다. 일관성·신뢰경계상 leave 알림 토글도 `leave.admin:configure`를 entry 권한으로 둔다 — 기존 `leave.admin` 리소스에 `configure` 액션을 `EXTRA_PERMISSIONS`에 추가(새 리소스 아님). 보유: OWNER(systemRole 자동) + pm. leave 권한 없는 위임 user-admin(`admin`)은 base `admin.settings:configure`는 가져도 entry 게이트에서 차단된다. **배포 주의(R4)**: `EXTRA_PERMISSIONS` 추가는 Permission 행만 만든다 — fresh install은 `bootstrapRolePermissions`가 pm(`"*"`)에 grant하나, **기존(비어있지 않은) DB는 bootstrap이 스킵**돼 pm이 grant를 못 받는다. 기존 DB는 `teams-upgrade`와 동형의 멱등 upgrade-once 헬퍼로 pm에 1회 grant한다(위임 admin 제외).

## 설계

### 1. 설정 카탈로그 — `src/kernel/settings/catalog.ts`

새 카테고리 **"leave"(연차)** 아래 `systemSetting` 3키 추가:

| 키 | title | description |
| --- | --- | --- |
| `leave.notifications.onRequest` | 연차 신청 알림 메일 | 직원이 연차를 신청하면 승인 권한자에게 알림 메일을 보냅니다. |
| `leave.notifications.onApprove` | 연차 승인 알림 메일 | 연차가 승인되면 신청자 본인에게 알림 메일을 보냅니다. |
| `leave.notifications.onReject` | 연차 반려 알림 메일 | 연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다. |

공통 필드: `kind: "systemSetting"`, `category: "leave"`, `schema: z.boolean()`, `default: true`, `audit: "full"`, `fallbackSafe: true`, `permission: { resource: "leave.admin", action: "configure" }`. `order`는 기존 워크플로(40번대) 다음 50/51/52.

> `audit: "full"` — boolean 토글값은 비민감(true/false)이라 before/after를 그대로 감사에 남겨 OFF/ON **방향**을 식별할 수 있게 한다(summary 모드는 type·changed만 남겨 `true→false`와 `false→true`를 구분 못 함 — 알림 억제 제어의 사고 추적에 불리).
>
> `permission` = `leave.admin:configure` — 기존 도메인 설정이 모두 도메인 스코프 configure를 쓰는 패턴(SMTP→`integrations.smtp:configure`, weekly→`workflows.weekly:configure`)을 따른다(§결정 D6). PUT 라우트는 base `admin.settings:configure` + entry `leave.admin:configure` 둘 다 요구 → leave 권한 없는 위임 user-admin은 차단.

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

`getSetting`은 boolean을 반환(미설정·무효 저장값 → catalog default `true`). 서비스 헬퍼 `notificationsEnabled(key)`는 `=== true`로 비교해 **"명시적 true일 때만 발송"**하고, **조회 예외는 catch해 `false`(fail-closed) 미발송** 처리한다(D4 개정). 즉 enqueue 게이트 = `notificationsEnabled(key)`가 true일 때만 `mailJob` 생성.

### 5. 메뉴 노출 — `src/kernel/access/catalog.ts`의 `NAV`

`admin` children 끝에 추가:

```
{ key: "admin-settings", label: "설정", href: "/admin/settings", permission: "admin.settings:view" }
```

`seedNavigation`은 create-if-absent이라 재시드 시 기존 트리에 신규 자식만 추가한다. `admin`은 top-level이므로 자식 추가가 depth-3 위반에 걸리지 않는다. `sortOrder`는 형제 인덱스 기반이라 마지막에 붙는다(메뉴 관리 화면에서 관리자가 재정렬 가능 — DB가 진실원 D3). **배포 시 `npm run db:seed` 필요**(신규 nav 항목 등록).

## 불변식 / 영향

- **토글 계약(명시 — codex 적대검증 반영):** OFF는 **"앞으로 발생할 이벤트의 메일을 큐에 적재하지 않음"**을 의미하는 **enqueue 시점 preference**다. 이미 적재됐거나 재시도 중인 `MailDelivery` 행은 발송되며(발송 워커 `drainLeaveMailOutbox` **무변경** — 비목표), 토글을 끄는 것이 outbox를 비우지 않는다. 즉 best-effort 발송 제어이지 규정용 하드 kill-switch가 아니다(ON일 때 발생한 이벤트는 정당하게 통지됨). 유일한 예외는 **조회 예외 시 fail-closed**(D4). in-flight 메일까지 막는 send-time 게이트는 의도적 비목표(워커 변경 회피).
- 연차 도메인 불변식과 **무관**: `usedDays` 캐시·status-CAS 트랜잭션·할당 차감은 그대로. 이번 변경은 **메일 enqueue의 조건부 스킵**과 표현계층(에디터·메뉴)뿐.
- 발송 시점 권한 재확정(REQUESTED를 drain이 `getLeaveAdminRecipients`로 재확정하는 SSOT)은 불변 — 토글은 **enqueue 시점 게이트**이고, 권한 경계는 발송 시점 게이트로 직교한다.
- REQUESTED "수신자 0명이어도 durable 적재"(phase-5 spec §8)와의 관계: 그 규칙은 "보내려 했으나 수신자가 없다"는 운영 가시성을 위한 것이다. 토글 OFF는 "보내지 않기로 한 명시적 결정"이므로 durable 적재 대상이 아니다(D2와 일관).
- 읽기 실패 fail-closed 억제의 관측성(R5 적대검증): 설정 조회 예외로 미발송한 경우 의도적 OFF(무로그)와 구분되도록 고유 마커(`LEAVE_NOTIFICATION_SUPPRESSED_BY_SETTINGS_READ_ERROR`)로 error 로깅한다(alert/grep). leave mutation 자체는 막지 않는다(메일↔업무 성공 분리 — phase-5). durable outbox 행(SKIPPED 등)은 두지 않는다: D2(enum 무변경)와 충돌하고, settings·leave가 동일 PostgreSQL이라 이 경로가 실무상 거의 도달하지 않기 때문(과설계 회피). 운영에서 마커가 실제 관측되면 durable trail을 재검토한다.
- Prisma 마이그레이션 없음 → 표준 restart 배포. 단 메뉴 노출은 `db:seed` 재실행으로 nav 항목을 등록해야 반영된다.
- 권한(D6): 토글 조작은 base `admin.settings:configure` + entry `leave.admin:configure`(둘 다 필요), 설정 화면 진입은 `admin.settings:view`. `leave.admin:configure`는 `EXTRA_PERMISSIONS`에 추가하는 신규 권한(기존 `leave.admin` 리소스의 configure 액션 — 새 리소스 아님). 설정 화면의 `listSettings`도 entry 권한으로 필터하므로, leave.admin:configure 없는 사용자에겐 토글이 노출되지 않는다.

## 테스트

- `tests/kernel/settings/catalog.test.ts`: 3키 존재, `default === true`, `z.boolean()` 파싱(true/false 통과, 비boolean reject), `category === "leave"`, `audit === "full"`(D6/E), `permission === { resource: "leave.admin", action: "configure" }`(D6). 카테고리 화이트리스트·항목 수(8/5/1/14) 갱신.
- `tests/kernel/access/*`(권한 catalog 테스트): `EXTRA_PERMISSIONS`에 `["leave.admin", "configure"]` 포함(D6 — 신규 권한 시드 가드).
- `tests/modules/leave/mail-wiring.test.ts`: 각 이벤트별 토글 ON→`insertPendingDelivery` 호출(mailJob 전달), OFF→미호출(null 전달). `getSetting` 모킹. 조회 예외→fail-closed 미발송(D4). 관리자등록은 토글 무관·`sendNotification`만 따름(D3 회귀 가드).
- `tests/kernel/access/nav-catalog.test.ts`(NAV 테스트): `admin` children에 `admin-settings` 포함, href·permission 일치.
- `tests/app/admin/settings-editor.test.tsx`: boolean `initialValue` → Switch 렌더, 토글 시 PUT body(`value: boolean`). 409→롤백, fetch 거부=ambiguous→`router.refresh`. 비boolean → textarea 유지.
