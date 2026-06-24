# 권한 매트릭스 묶음 부여·역할 표시 개선 설계

- 날짜: 2026-06-24
- 대상: `src/app/(app)/admin/roles/`(권한 매트릭스 화면), `src/modules/admin/roles/`, `prisma/seed.ts`
- 선행: `docs/specs/2026-06-23-teams-and-permission-matrix-design.md`(매트릭스 편집기·anti-escalation 가드 — PR #15)

## 배경·문제

권한 매트릭스 편집기는 셀 하나하나를 개별 `PUT`으로만 바꿀 수 있다. 역할에 `admin.*`,
`calendar.*` 같은 도메인 권한 전체를 부여하려면 수십 개 셀을 일일이 조작해야 해 번거롭다.
또한 역할 열의 표시명·순서가 운영자가 원하는 형태와 다르다.

## 목표

1. 역할 열의 **표시명 변경 + 순서 고정**.
2. 도메인 그룹 단위(`admin` 전체 등)로 한 역할에 권한을 **묶어서** ALLOW/DENY/해제.
3. 기존 **개별 셀 편집은 그대로 유지**.
4. 묶음 부여도 기존 anti-escalation 가드를 **빠짐없이 통과**(권한 상승 차단 불변식 유지).

비목표: 스키마 변경, 새 권한 추가, scope별 묶음(묶음은 scope `all` 고정), pm 역할 편집 허용.

## 결정 사항

### D1 — 역할 열 표시 순서 (`ROLE_DISPLAY_ORDER`)

`getMatrix()`는 현재 `key` 알파벳 오름차순으로 역할을 정렬한다. 이를 명시적 표시 순서
상수로 교체한다. `src/kernel/access/catalog.ts`에 추가:

```ts
// 권한 매트릭스 열 표시 순서(UX 전용). 시드·타입용 ACCESS_ROLE_KEYS와 별개.
export const ROLE_DISPLAY_ORDER = [
  "admin", "pm", "regular-developer",
  "contractor-developer", "contractor-content", "contractor-civil-response",
] as const;
```

`getMatrix()`는 조회 후 이 배열의 index로 역할을 정렬한다(목록에 없는 키는 말미, 안정 정렬).
`ACCESS_ROLE_KEYS`(시드·타입 union의 의미 상수)는 변경하지 않는다 — surgical.

### D2 — 역할 표시명 변경 (`prisma/seed.ts` `ROLE_NAMES`)

표시명은 `AccessRole.name`이 단일 출처이며 `seed.ts`의 `ROLE_NAMES` upsert로 적재된다.
다음과 같이 변경한다(나머지는 유지):

| key | 기존 | 변경 후 |
| --- | --- | --- |
| `admin` | 사용자 관리자 | **관리자** |
| `pm` | PM | PM (유지) |
| `regular-developer` | 정규 개발자 | 정규 개발자 (유지) |
| `contractor-developer` | 외주 개발자 | 외주 개발자 (유지) |
| `contractor-content` | 외주 컨텐츠관리 | **콘텐츠관리** |
| `contractor-civil-response` | 외주 민원응대 | **민원응대** |

스키마 변경 없음. 기존 DB에는 **재시드(`npm run db:seed`) 시 반영**된다(upsert의 `update: { name }`).
배포 절차상 seed는 항상 실행되므로 별도 마이그레이션 불필요.

### D3 — 도메인 그룹 정의 (첫 세그먼트 전체)

권한 `resource`의 `.` 앞 첫 세그먼트로 그룹화한다. 그룹과 표시 순서·라벨:

| 그룹 키 | resource 예 | 라벨 |
| --- | --- | --- |
| `dashboard` | `dashboard` | 대시보드 |
| `calendar` | `calendar.work`, `calendar.leave` … | 캘린더 |
| `workflows` | `workflows.weekly` … | 업무 |
| `leave` | `leave.request`, `leave.approval` … | 연차 |
| `admin` | `admin.users`, `admin.roles` … | 관리 |
| `integrations` | `integrations.google` … | 연동 |

그룹 정렬은 위 순서(메뉴와 동일). 그룹 내 권한은 기존대로 `resource`·`action` 오름차순.
그룹 라벨·순서는 매트릭스 화면 전용이므로 `matrix-editor.tsx`(또는 그 인접 모듈)에 상수로 둔다.

### D4 — 접기/펼치기 그룹 헤더행

- 각 그룹마다 헤더행을 그린다. 좌측에 `▼/▶` 토글(클라이언트 state, 기본 **펼침**).
- 접으면 그 그룹의 개별 권한 행을 감춘다(헤더행은 항상 표시) → 긴 목록 정리.
- 토글 상태는 클라이언트 로컬 state만(서버 저장 없음).

### D5 — 그룹×역할 묶음 컨트롤

- 헤더행의 각 역할 칸에 `[일괄 ▾]` 셀렉트: `ALLOW 전체` / `DENY 전체` / `해제 전체`.
- 선택 시 그 **그룹의 모든 권한 × 그 역할**에 해당 effect를 적용한다(scope는 `all`).
- pm 열, 비-OWNER(읽기 전용)에서는 개별 셀과 동일하게 잠금(셀렉트 비활성).

### D6 — 묶음 API·서비스 (per-cell 가드 재사용)

신규 라우트: `PUT /api/admin/roles/[roleId]/permissions/bulk`

```jsonc
// body
{ "resourcePrefix": "admin", "effect": "ALLOW" }   // effect ∈ "ALLOW" | "DENY" | "none"
```

신규 서비스 `setRoleCellsBulk(actorId, roleId, resourcePrefix, effect)`:

1. `requirePermission(actorId, "admin.roles", "configure")` + `assertOwner(actorId)` **1회**(빠른 pre-check).
2. role 존재·`key !== "pm"` 확인(pm 거부).
3. `resourcePrefix` 첫 세그먼트와 일치하는 권한 목록을 조회(`resource === prefix || resource.startsWith(prefix + ".")`).
4. 각 권한에 대해 **기존 per-cell 검증 + `repository.setCell`을 그대로 재사용**한다.
   - 즉 `setRoleCell` 안의 per-permission 가드(`admin.roles:configure` ALLOW 차단,
     비특권 역할 × critical prefix ALLOW 차단, scope 제약, DENY scope 정규화)를 권한마다 적용.
   - `repository.setCell`은 셀 단위 advisory lock·트랜잭션 내 OWNER 재확인·audit를 그대로 유지
     (동시성/감사 불변식 변경 없음).
5. 가드에 걸리는 권한은 **건너뛰고**(throw를 그 권한에 대해서만 흡수) 사유를 모은다.
6. 반환: `{ applied: number, skipped: Array<{ key: string; reason: string }> }`.

리팩터 포인트: 현 `setRoleCell`의 per-permission 검증부를 순수 함수(예: `assertCellAllowed(role, perm, effect, scope)`)로
추출해 단건·묶음이 공유한다. 단건 경로의 동작·반환은 불변.

### D7 — 부분 적용(skip-and-report) 의미

- 묶음은 **전체 실패가 아니라 부분 적용**이다. 통과한 셀만 반영하고 차단된 셀은 사유와 함께 보고.
- 예시 결과:
  - 비특권 역할(정규개발·외주 3종) × `admin` ALLOW → 전 셀 차단 → `applied:0`, 모든 항목 skip
    (사유: "비특권 역할에는 critical 권한을 부여할 수 없습니다").
  - `admin` 역할(관리자) × `admin` ALLOW → `admin.roles:configure` 1건만 skip(OWNER 전용), 나머지 적용.
  - DENY/해제는 권한 제거 방향이라 상승 위험 없음 → critical 차단 가드 비적용(기존 단건 동작과 동일).
- 프론트는 결과 요약을 화면에 노출(예: `"관리 → 관리자: 6건 적용, 1건 건너뜀 (admin.roles:configure는 OWNER 전용)"`).
  적용 후 `router.refresh()`로 매트릭스 갱신.

### D8 — 잠금·권한 검사 동등성

- 묶음도 단건과 **동일한 키**(`admin.roles:configure`)를 검사. UI 잠금(pm·비-OWNER)과 서버 가드가 어긋나지 않게 한다.
- 비-OWNER가 bulk 라우트를 직접 호출해도 `assertOwner`로 거부(fail-closed).

## 영향 범위 (파일)

- `src/kernel/access/catalog.ts` — `ROLE_DISPLAY_ORDER` 추가.
- `src/modules/admin/roles/repositories/index.ts` — `getMatrix` 정렬 변경; `setCell` 변경 없음.
- `src/modules/admin/roles/services/index.ts` — `assertCellAllowed` 추출, `setRoleCellsBulk` 추가; `setRoleCell` 동작 불변.
- `src/modules/admin/roles/validations/index.ts` — `bulkSetSchema` 추가.
- `src/app/api/admin/roles/[roleId]/permissions/bulk/route.ts` — 신규.
- `src/app/(app)/admin/roles/_components/matrix-editor.tsx` — 그룹화·접기/펼치기·묶음 셀렉트·결과 요약.
- `prisma/seed.ts` — `ROLE_NAMES` 3건 변경.
- `tests/` — 묶음 서비스 가드·그룹화·정렬 테스트.

## 테스트 (성공 기준)

서비스 `setRoleCellsBulk`:
- ALLOW 전체 / DENY 전체 / 해제 전체가 prefix 매칭 권한에 적용된다.
- 비특권 역할 × `admin` ALLOW → `applied:0`, 모든 항목 skip(사유 포함).
- `admin` 역할 × `admin` ALLOW → `admin.roles:configure`만 skip, 나머지 적용.
- pm 역할 → 거부(ForbiddenError). 비-OWNER actor → 거부.
- DENY/해제는 critical 차단 가드를 적용하지 않는다(비특권 역할에도 admin DENY 가능).

매트릭스/정렬:
- `getMatrix`가 `ROLE_DISPLAY_ORDER` 순서로 역할을 반환한다.
- 그룹화 헬퍼가 6개 그룹·올바른 라벨/순서를 만든다.
- 단건 `setRoleCell` 동작·가드가 회귀 없이 동일(기존 테스트 green 유지).

## 배포 메모

- 스키마 변경 없음 → 표준 절차(build → `pm2 restart`). 단 **역할 표시명 변경은 `npm run db:seed` 실행 시 반영**되므로
  배포 시 seed 단계를 포함한다(기존 dev 배포 절차에 이미 포함).
