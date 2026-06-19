# Task 10 — seed: CalendarSource + 외주 권한 보정 + 데모 데이터

세 가지: (a) **외주 역할에 `calendar.leave:view` 부여**(§8.1 — 단위 테스트 대상), (b) HOLIDAY/Google `CalendarSource` seed, (c) Phase 5/6 전 leave/work 뷰가 비지 않도록 데모 `WorkflowTask`/`LeaveRequest` seed. (a)는 `ROLE_ALLOW`를 별도 모듈로 추출해 테스트 가능하게 한다.

## Files

- Create: `prisma/seed-roles.ts` (ROLE_ALLOW 추출 + 외주 권한 추가)
- Modify: `prisma/seed.ts` (ROLE_ALLOW import 전환 + CalendarSource/데모 seed)
- Test: `tests/prisma/seed-roles.test.ts`

## Prep

- 검증된 enum 값: `WorkflowKind`(WEEKLY_REPORT/BILLING/NOTIFICATION_BILLING), `LeaveType`(ANNUAL/HALF/QUARTER), `LeaveRequestStatus`(PENDING/APPROVED/REJECTED/CANCELLED), `WorkflowStatus`(PENDING…).
- 현재 `prisma/seed.ts`의 `ROLE_ALLOW`(라인 24~49)와 admin 생성(step 4)·nav(step 5) 구조.
- Spec §8.1, §16.

## Deps

01(개념). 실제로는 schema/seed만 의존.

## Steps

### 1. ROLE_ALLOW 추출 + 외주 권한 추가 → 테스트 먼저 (FAIL 확인)

`tests/prisma/seed-roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ROLE_ALLOW } from "../../prisma/seed-roles";

describe("ROLE_ALLOW 외주 역할 캘린더 권한", () => {
  const contractorRoles = ["contractor-developer", "contractor-content", "contractor-civil-response"];

  it("외주 3역할 모두 calendar.leave:view 보유(§8.1)", () => {
    for (const role of contractorRoles) {
      expect(ROLE_ALLOW[role]).toContain("calendar.leave:view");
    }
  });

  it("외주 역할은 work/personal 캘린더도 유지", () => {
    for (const role of contractorRoles) {
      expect(ROLE_ALLOW[role]).toContain("calendar.work:view");
      expect(ROLE_ALLOW[role]).toContain("calendar.personal:view");
    }
  });

  it("정규 개발자도 calendar.leave:view 유지(회귀 방지)", () => {
    expect(ROLE_ALLOW["regular-developer"]).toContain("calendar.leave:view");
  });
});
```

실행(FAIL — 파일 없음): `npm test -- tests/prisma/seed-roles.test.ts`

`prisma/seed-roles.ts` (현재 seed.ts의 ROLE_ALLOW를 그대로 옮기고 외주 3역할에 `calendar.leave:view` 추가):

```ts
// role → 허용 "resource:action" 키. 명확한 셀만(ALLOW). "제한"은 미포함 → 거부 유지.
// seed.ts가 import한다. 외주 역할의 calendar.leave:view는 Phase 3 §8.1에서 추가됨
// (외주 인력이 휴가 신청 당사자이자 cutover 주 사용자 — workspace-env INVENTORY §1.5).
export const ROLE_ALLOW: Record<string, string[]> = {
  // pm 권한은 OWNER systemRole로 전부 허용되지만, 비-OWNER PM 대비 명시 ALLOW도 부여.
  pm: ["*"],
  "regular-developer": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "calendar.team:view", "workflows.weekly:view", "workflows.billing:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.weekly:create", "workflows.weekly:generate",
    "workflows.notification:create",
  ],
  "contractor-developer": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "workflows.weekly:view", "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.weekly:create", "workflows.notification:create",
  ],
  "contractor-content": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "workflows.weekly:view", "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.weekly:create", "workflows.notification:create",
  ],
  "contractor-civil-response": [
    "dashboard:view", "calendar.work:view", "calendar.leave:view", "calendar.personal:view",
    "workflows.notification:view", "leave.request:view",
    "leave.request:create", "workflows.notification:create",
  ],
};
```

실행(PASS): `npm test -- tests/prisma/seed-roles.test.ts`

### 2. seed.ts에서 ROLE_ALLOW import로 전환

`prisma/seed.ts` 상단 import 추가(기존 `EXTRA_PERMISSIONS` import 아래):

```ts
import { ROLE_ALLOW } from "./seed-roles";
```

그리고 기존 인라인 `const ROLE_ALLOW: Record<string, string[]> = { … };` 블록(현재 라인 24~49) **전체 삭제**. 나머지 `ACCESS_ROLES`/`NAV`/`splitKey`/`main` 로직은 그대로 둔다(ROLE_ALLOW 참조는 import로 해결됨).

### 3. CalendarSource + 데모 데이터 seed 추가

`prisma/seed.ts`의 `main()` 안, **nav 루프(step 5) 다음·`console.log` 직전**에 아래 블록을 추가한다(`admin`이 스코프에 있어야 하므로 step 4 이후):

```ts
  // 6. CalendarSource — 공휴일(Google 공휴일 캘린더) + 설정된 Google 캘린더(best-effort)
  const HOLIDAY_CAL_ID = "ko.south_korea#holiday@group.v.calendar.google.com";
  await prisma.calendarSource.upsert({
    where: { key: "holiday-kr" },
    update: { name: "대한민국 공휴일", externalId: HOLIDAY_CAL_ID, cacheTtlSeconds: 86_400, syncStatus: "ACTIVE" },
    create: { key: "holiday-kr", kind: "HOLIDAY", name: "대한민국 공휴일", provider: "google", externalId: HOLIDAY_CAL_ID, cacheTtlSeconds: 86_400, visibility: "PUBLIC" },
  });

  const calIdsRow = await prisma.systemSetting.findUnique({ where: { key: "integrations.google.calendarIds" } });
  const calIds = Array.isArray(calIdsRow?.value) ? (calIdsRow.value as string[]) : [];
  for (const calId of calIds) {
    await prisma.calendarSource.upsert({
      where: { key: `google:${calId}` },
      update: { externalId: calId, syncStatus: "ACTIVE" },
      create: { key: `google:${calId}`, kind: "GOOGLE_CALENDAR", name: `Google: ${calId}`, provider: "google", externalId: calId, cacheTtlSeconds: 900, visibility: "TEAM" },
    });
  }

  // 7. 데모 데이터 — Phase 5/6 전까지 leave/work 뷰가 비지 않도록 현재 월에 샘플 1건씩.
  const now = new Date();
  const wfType = await prisma.workflowType.upsert({
    where: { kind: "WEEKLY_REPORT" },
    update: {},
    create: { id: "wf-weekly", kind: "WEEKLY_REPORT", name: "주간보고", templatePath: "Template/weekly.docx", recurrence: "WEEKLY" },
  });
  await prisma.workflowTask.upsert({
    where: { id: "sample-task-1" },
    update: { scheduledAt: new Date(now.getFullYear(), now.getMonth(), 12, 9, 0) },
    create: { id: "sample-task-1", typeId: wfType.id, scheduledAt: new Date(now.getFullYear(), now.getMonth(), 12, 9, 0), status: "PENDING" },
  });
  await prisma.leaveRequest.upsert({
    where: { id: "sample-leave-1" },
    update: {},
    create: { id: "sample-leave-1", userId: admin.id, leaveType: "ANNUAL", startDate: new Date(now.getFullYear(), now.getMonth(), 15), endDate: new Date(now.getFullYear(), now.getMonth(), 16), days: 2, status: "APPROVED", reason: "데모 연차" },
  });
```

`console.log` 메시지에 `calendarSources` 한 줄을 덧붙여도 좋다(선택).

### 4. commit

```
git add prisma/seed-roles.ts prisma/seed.ts tests/prisma/seed-roles.test.ts
git commit -m "seed: grant contractors calendar.leave:view; seed holiday/google sources + demo data"
```

## Acceptance Criteria

- `npm test -- tests/prisma/seed-roles.test.ts` → PASS(외주 3역할 calendar.leave:view 보유).
- `npm run prisma:validate` → 스키마 유효(변경 없음).
- `npm run typecheck` / `npm run lint` → OK.
- (DB 연결 시) `npm run db:seed` → 오류 없이 CalendarSource(holiday-kr 등)·데모 task/leave 생성. **이 DB 검증은 node 단위 테스트 범위 밖**이며 dev DB(터널)에서 수동 확인한다.

## Cautions

- **seed.ts를 테스트에서 직접 import하지 말 것.** 이유: 최상위 `main()`이 실행되어 DB 연결을 시도한다. 권한 매트릭스 검증은 부수효과 없는 `seed-roles.ts`만 import한다.
- **데모 LeaveRequest/WorkflowTask를 production seed에 영구로 남기지 말 것(인지).** 이유: Phase 6 마이그레이션 시 실데이터와 섞이면 안 된다. 고정 id(`sample-*`)로 두어 추후 제거가 쉽게 한다. (제거는 Phase 5/6 작업.)
- **`google:${calId}` 외 다른 키 스킴으로 바꾸지 말 것.** 이유: 재seed 시 calId 순서가 바뀌어도 동일 source에 매핑되어야 한다(인덱스 기반 키는 재정렬에 취약).
