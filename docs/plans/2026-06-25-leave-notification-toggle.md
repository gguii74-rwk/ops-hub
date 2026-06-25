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

신규 카테고리 `"leave"` 아래 개별 boolean 3키. 공통 필드: `kind: "systemSetting"`, `category: "leave"`, `permission: { resource: "admin.settings", action: "configure" }`, `schema: z.boolean()`, `default: true`, `audit: "summary"`, `fallbackSafe: true`.

| key | order | title | description |
| --- | --- | --- | --- |
| `leave.notifications.onRequest` | 50 | 연차 신청 알림 메일 | 직원이 연차를 신청하면 승인 권한자에게 알림 메일을 보냅니다. |
| `leave.notifications.onApprove` | 51 | 연차 승인 알림 메일 | 연차가 승인되면 신청자 본인에게 알림 메일을 보냅니다. |
| `leave.notifications.onReject` | 52 | 연차 반려 알림 메일 | 연차가 반려되면 신청자 본인에게 알림 메일을 보냅니다. |

`SYSTEM_KEYS`는 `CATALOG`에서 파생되므로 자동 포함. 신규 권한 없음(`admin.settings:configure`는 기존 권한 — 기존 설정 write 라우트가 이미 사용).

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
      console.warn(`[leave] 알림 설정 조회 실패(${key}) — fail-closed로 미발송:`, e);
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

## 적대검증 판정(ledger)

plan 단계 codex 적대검증 결과 — 모든 blocking finding 판정 완료:

| finding | severity | disposition | 근거 |
| --- | --- | --- | --- |
| fetch 거부 시 토글 상태 고착 — task-02 (R1) | high | **FIXED** | 실제 결함(spec §3 롤백 의도 미충족). `putSetting`을 try/catch로 절대 throw 안 하게 + 호출부 try/finally로 `saving` 항상 해제 + fetch 거부 롤백 테스트 추가. R2에서 소멸 확인. |
| 설정 조회 실패 시 fail-open — task-03 (R1·R2) | high | **FIXED** | codex 2회 no-ship 지적 → 사용자 결정(2026-06-25)으로 **D4 개정: 읽기 예외 fail-closed**. `notificationsEnabled` catch가 `false` 반환, 헬퍼 `=== true` 비교, fail-closed 테스트로 잠금. spec D4·§4·§불변식 갱신. |
| OFF가 enqueue 시점만 게이트(발송 시점 미게이트) — task-03 (R2) | high | **ACCEPTED** | 발송 워커 무변경은 spec **명시적 비목표**. 사용자 결정(2026-06-25)으로 in-flight/큐된 메일 발송 유지 확정(best-effort enqueue preference, 규정용 kill-switch 아님). 보완: spec §불변식에 토글 계약 명문화. |

## 배포 주의

Prisma 마이그레이션 없음 → **표준 restart**. 단 메뉴 노출(task-04)은 `npm run db:seed` 재실행으로 신규 nav 항목(`admin-settings`)을 등록해야 화면에 반영된다(`seedNavigation`은 create-if-absent).
