# 연차 알림 메일 발송 토글 + 설정 메뉴 노출 — 구현 계획

- 날짜: 2026-06-25
- spec: `docs/specs/2026-06-25-leave-notification-toggle-design.md`
- 브랜치: `feat/leave-notification-toggle`

## Goal

연차 신청/승인/반려 3개 이벤트의 알림 메일을 관리자가 설정 화면에서 이벤트별로 켜고 끄게 하고, 사이드바 "관리" 트리에 누락된 "설정" 항목을 노출한다.

## Architecture

표현계층(설정 카탈로그·에디터·메뉴)과 연차 서비스의 **enqueue 시점 게이트**만 건드린다. 토글 OFF 시 서비스가 `mailJob = null`을 repository에 넘기면 기존 `if (mailJob)` 가드가 enqueue를 자동 스킵한다 — repository·트랜잭션·발송 워커·연차 도메인 불변식(usedDays·status-CAS)은 **무변경**. Prisma 마이그레이션 없음(SystemSetting은 임의 키 수용).

## Tech Stack

Next.js App Router, TypeScript, Zod(설정 schema), Prisma(무변경), vitest(+jsdom for tsx), `@/components/ui/switch`(기존 프리미티브).

## For agentic workers — execution contract (MUST)

REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. This plan is split into per-task files (`2026-06-25-leave-notification-toggle/task-NN-<slug>.md`). Task bodies (Files, TDD steps, AC) are **NOT** in this entrypoint. To execute, MUST: ① read this entrypoint's §Shared Contracts → ② load exactly one target task file → ③ run its steps in order. Do not start implementing from the entrypoint alone (it has no steps). Do not load all task files at once.

## Shared Contracts

### SC-1. 설정 키 3개 (catalog `systemSetting`)

신규 카테고리 `"leave"` 아래 개별 boolean 3키. 공통 필드: `kind: "systemSetting"`, `category: "leave"`, `permission: { resource: "leave.admin", action: "configure" }`(D6 — 도메인 스코프), `schema: z.boolean()`, `default: true`, `audit: "full"`(E — OFF/ON 방향 감사 기록), `fallbackSafe: true`.

| key | order | title | description |
| --- | --- | --- | --- |
| `leave.notifications.onRequest` | 50 | 연차 신청 알림 메일 | 직원이 연차를 신청하면 승인 권한자에게 알림 메일을 보냅니다. |
| `leave.notifications.onApprove` | 51 | 연차 승인 알림 메일 | 연차가 승인되면 신청자 본인에게 알림 메일을 보냅니다. |
| `leave.notifications.onReject` | 52 | 연차 반려 알림 메일 | 연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다. |

`SYSTEM_KEYS`는 `CATALOG`에서 파생되므로 자동 포함. **권한(D6)**: 쓰기 = PUT 라우트가 base `admin.settings:configure` + entry `leave.admin:configure` 둘 다 요구. `leave.admin:configure`는 `prisma/seed-permissions.ts`의 `EXTRA_PERMISSIONS`에 `["leave.admin", "configure"]`로 신규 추가(기존 `leave.admin` 리소스의 configure 액션 — 새 리소스 아님). 보유: OWNER(systemRole 자동) + pm. leave 권한 없는 위임 user-admin은 차단.
- **fresh install**: `bootstrapRolePermissions`가 pm `"*"`로 grant(task-01).
- **기존 DB**(RolePermission 행 존재 → bootstrap 스킵): task-05의 멱등 upgrade-once 헬퍼가 pm에 grant(R4 — 이게 없으면 기존 배포 pm이 토글 403/미노출).

### SC-2. 게이트 의미론 (서비스)

- 게이트 facade: `import { getSetting } from "@/kernel/settings/reader"` (모듈 경계 허용 — eslint element-types `module→kernel` + restricted-imports에 `reader` 미포함).
- `getSetting(key): Promise<unknown>`. 미설정·무효 저장값이면 catalog `default: true`(ON) 반환(예외 아님).
- **명시적 true일 때만 발송**(`=== true`). 조회가 **예외로 실패**하면 **fail-closed(미발송)**(D4 개정 — 2026-06-25 사용자 결정).
- 헬퍼(서비스 모듈 내부, task-03이 정의):
  ```ts
  // 알림 토글 — 명시적 true일 때만 발송(기본 ON: 미설정/무효저장값은 getSetting이 default true 반환).
  // 조회 예외(인프라 장애·UnknownSettingError 등)는 fail-closed로 미발송(D4 개정).
  async function notificationsEnabled(key: string): Promise<boolean> {
    try {
      return (await getSetting(key)) === true;
    } catch (e) {
      // 읽기 실패 억제 ≠ 의도적 OFF(R5): 고유 마커로 error 로깅 → alert/grep. 동일 DB라 이 경로는 거의 도달 안 함.
      console.error(`[leave] LEAVE_NOTIFICATION_SUPPRESSED_BY_SETTINGS_READ_ERROR key=${key} — fail-closed(미발송):`, e);
      return false;
    }
  }
  ```
- `createLeaveRequest`: OFF면 `mailJob = null`, **`triggerLeaveMailDrain()`은 `mailJob`이 있을 때만** 호출.
- `approve`/`reject`: OFF면 `mailJob = null`. `triggerLeaveMailDrain()`은 **기존대로 무조건 호출**(이메일 없을 때도 호출하는 backstop 동작 보존 — 호출돼도 무해).
- `createLeaveRequestByAdmin`: **변경 없음**(D3 — `sendNotification` 건별 제어 유지, `getSetting` 미조회).

### SC-3. PUT 설정 API 계약 (에디터가 호출)

`PUT /api/admin/settings/[key]`:
- 요청 body: `{ value: <설정값>, expectedUpdatedAt: string | null }` (null=최초 생성, ISO=낙관적 락 토큰).
- 응답: 성공 `{ updatedAt: string }`; `409`=동시성 충돌; `422`=검증 실패; `400`=토큰 누락/형식; 그 외 실패.
- 토큰은 응답의 `updatedAt`으로 갱신해 다음 쓰기에 전달.

### SC-4. UI 프리미티브 `Switch` (재사용 — 신설 금지)

`src/components/ui/switch.tsx` (기존):
```ts
Switch({ checked: boolean; onCheckedChange: (next: boolean) => void; disabled?: boolean; label?: string; className?: string })
```
`role="switch"`, `aria-checked` 렌더. boolean 설정 토글에 사용.

### SC-5. 기존 테스트 영향 (누가 고치는가)

| 기존 테스트 | 깨지는 이유 | 고치는 task |
| --- | --- | --- |
| `tests/kernel/settings/catalog.test.ts` | 카테고리 화이트리스트(L11)·항목 수(L64–67: 5/5/1/11) 하드코딩 | task-01 |
| `tests/kernel/access/nav-catalog.test.ts` | admin 자식 4개 `toEqual`(L24–32) | task-04 |
| `tests/modules/leave/mail-wiring.test.ts` | requests.ts가 `getSetting` import → real getSetting이 미모킹 prisma 호출로 크래시 | task-03 (reader 모킹 추가 + OFF 케이스 추가) |
| `tests/modules/leave/requests-service.test.ts` | 동일 — real getSetting 크래시 | task-03 (reader 모킹 1줄 추가) |

`tests/kernel/access/navigation-catalog.test.ts`는 `.find()`만 써서 admin 자식 추가에 **안 깨짐**(고칠 필요 없음). `tests/app/api/admin/settings.test.ts`는 고정 키만 검사 — 카탈로그 항목 추가에 **무영향**.

## Task table

| # | title | status | file | deps | outcome |
|---|-------|--------|------|------|---------|
| 01 | 설정 카탈로그 — leave 카테고리 + 3키 + 화면 노출 | [ ] | [task-01](2026-06-25-leave-notification-toggle/task-01-settings-catalog.md) | — | |
| 02 | 설정 에디터 boolean 분기(Switch) | [ ] | [task-02](2026-06-25-leave-notification-toggle/task-02-settings-editor-boolean.md) | — | |
| 03 | 연차 서비스 알림 게이트 | [ ] | [task-03](2026-06-25-leave-notification-toggle/task-03-service-gate.md) | 01 | |
| 04 | 사이드바 "설정" 메뉴 노출(NAV) | [ ] | [task-04](2026-06-25-leave-notification-toggle/task-04-nav-menu.md) | — | |
| 05 | leave.admin:configure 권한 업그레이드(기존 DB) | [ ] | [task-05](2026-06-25-leave-notification-toggle/task-05-leave-permission-upgrade.md) | 01 | |

## 검토 판정(ledger)

plan 단계 검토 결과 — 모든 blocking finding 판정 완료:

| finding | severity | disposition | 근거 |
| --- | --- | --- | --- |
| fetch 거부 시 토글 상태 고착 — task-02 (R1) | high | **FIXED** | 실제 결함(spec §3 롤백 의도 미충족). `putSetting`을 try/catch로 절대 throw 안 하게 + 호출부 try/finally로 `saving` 항상 해제 + fetch 거부 롤백 테스트 추가. R2에서 소멸 확인. |
| 설정 조회 실패 시 fail-open — task-03 (R1·R2) | high | **FIXED** | 검토에서 2회 반복 제기 → 사용자 결정(2026-06-25)으로 **D4 개정: 읽기 예외 fail-closed**. `notificationsEnabled` catch가 `false` 반환, 헬퍼 `=== true` 비교, fail-closed 테스트로 잠금. spec D4·§4·§불변식 갱신. |
| OFF가 enqueue 시점만 게이트(발송 시점 미게이트) — task-03 (R2) | high | **ACCEPTED** | 발송 워커 무변경은 spec **명시적 비목표**. 사용자 결정(2026-06-25)으로 in-flight/큐된 메일 발송 유지 확정(best-effort enqueue preference, 규정용 kill-switch 아님). 보완: spec §불변식에 토글 계약 명문화. |
| 모호한 쓰기 결과를 미반영으로 단정·롤백 — task-02 (R3) | high | **FIXED** | `putSetting`을 판별 유니온으로. 응답 미수신(fetch 거부)·2xx 본문 파싱 실패 → 롤백 대신 `router.refresh()`로 권위 재조회 + `useEffect` props 재동기화. (**R5에서 정정**: 409도 stale이라 refetch 대상 — 아래 R5 행 참조. 롤백은 422 등 행-불변에만.) |
| 토글 쓰기가 generic admin.settings:configure로 도메인 경계 위반 — task-01 (R3) | high | **FIXED** | 사용자 결정(2026-06-25, D6)으로 entry 권한을 `leave.admin:configure`(도메인 스코프)로 변경 — 기존 SMTP/weekly 패턴 일치. `EXTRA_PERMISSIONS`에 추가, OWNER+pm 보유, 위임 user-admin 차단. |
| 감사 summary가 OFF/ON 방향 미기록 — task-01 (R3) | medium | **FIXED** | 토글 `audit: "summary"` → `"full"`. boolean은 비민감이라 before/after 그대로 기록 → 방향 식별 가능. |
| 신규 권한이 기존 DB의 pm에 grant 안 됨(db:seed bootstrap-if-empty 스킵) — task-05 (R4) | high | **FIXED** | `EXTRA_PERMISSIONS` 추가만으론 기존 배포 pm이 grant 못 받아 토글 403/미노출. task-05 신설: `applyTeamsPermissionUpgrade` 패턴의 멱등 upgrade-once 헬퍼로 pm에 `leave.admin:configure` 1회 grant(위임 admin 제외, fail-closed). 정적 배열 테스트가 못 잡는 배포 skew를 비빈 DB 테스트로 커버. |
| 409를 prev로 롤백 → stale 권위 상태 표시 — task-02 (R5) | high | **FIXED** | R3에서 409를 rejected(롤백)로 분류한 게 오류 — 409는 "행 이미 변경"이라 prev도 stale. `PutResult`에 `refetch` 도입: 409 + 결과 불명(fetch 거부·파싱 실패)는 `router.refresh()` 재조회, 롤백은 `rejected`(422 등 행-불변)에만. 409=refetch·422=rollback 테스트로 잠금. |
| 읽기 실패 fail-closed 억제가 의도적 OFF와 구분 불가·복구 불가 — task-03 (R5) | high | **FIXED(경량) + ACCEPTED(잔여)** | FIXED: console.warn→고유 마커 `LEAVE_NOTIFICATION_SUPPRESSED_BY_SETTINGS_READ_ERROR` error 로깅으로 alert/grep 가능(의도적 OFF는 무로그라 구분됨). ACCEPTED 잔여: mutation 차단(메일↔업무 분리 위반)·durable outbox 행(D2 no-enum-change, 동일-DB라 near-unreachable=과설계)은 미채택. 운영 관측 시 durable trail 재검토. **사용자 surface 대상.** |

## 배포 주의

Prisma 마이그레이션 없음 → **표준 restart**. 단 `npm run db:seed` 재실행이 필요하다: ① 신규 nav 항목(`admin-settings`, task-04) 등록(`seedNavigation` create-if-absent), ② 신규 권한 `leave.admin:configure`(task-01, D6) 등록. 둘 다 seed 누락 시 메뉴 미노출/토글 권한 OWNER 한정이 된다.
