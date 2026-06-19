# Task 10 — seed: CalendarSource + 외주 권한 보정 (데모는 dev 전용 분리)

세 가지: (a) **외주 역할에 `calendar.leave:view` 부여**(§8.1 — 단위 테스트 대상), (b) HOLIDAY/Google `CalendarSource` seed(실 config — 메인 seed). Google 소스는 선택적 owner-map(`integrations.google.calendarOwners`: calId→이메일)으로 `ownerUserId`를 채운다 — map 없으면 null(공유/팀, **Phase 3 기본**). dedup·personal-google이 이 attribution에 의존(§10). (c) leave/work 뷰가 비지 않도록 데모 `WorkflowTask`/`LeaveRequest`를 **dev 전용 `prisma/seed-demo.ts`로 분리**(메인 `db:seed` 경로엔 미포함 — production/cutover에 가짜 승인 휴가·업무가 권위 데이터로 주입되는 것 방지, 적대적 리뷰 Finding 1). (a)·(b)의 순수 로직(`ROLE_ALLOW`, calId→ownerUserId 해석)은 별도 모듈로 추출해 테스트 가능하게 한다.

## Files

- Create: `prisma/seed-roles.ts` (ROLE_ALLOW 추출 + 외주 권한 추가)
- Create: `prisma/seed-google.ts` (calId→ownerUserId 순수 resolver + calId→불투명 source key 생성기 `googleSourceKey`)
- Create: `prisma/seed-demo.ts` (dev 전용 데모 WorkflowTask/LeaveRequest)
- Modify: `prisma/seed.ts` (ROLE_ALLOW·resolveGoogleOwnerId import 전환 + CalendarSource seed(ownerUserId 포함) — 데모는 제외)
- Modify: `package.json` (`db:seed:demo` 스크립트 추가)
- Test: `tests/prisma/seed-roles.test.ts`, `tests/prisma/seed-google.test.ts`

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

### 1b. Google 소스 owner resolver (테스트 먼저)

Google 소스에 `ownerUserId`를 채우는 순수 로직. 명시적 owner-map(calId→이메일)이 있을 때만 그 이메일의 userId로 귀속한다. dedup·personal-google이 이 attribution에 의존하므로(§10) 단위 테스트로 못 박는다.

`tests/prisma/seed-google.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveGoogleOwnerId, googleSourceKey } from "../../prisma/seed-google";

describe("resolveGoogleOwnerId", () => {
  const userIdByEmail = { "u9@corp.com": "user-9" };

  it("owner-map에 매핑된 calId → 해당 userId", () => {
    expect(resolveGoogleOwnerId("cal-9@group", { "cal-9@group": "u9@corp.com" }, userIdByEmail)).toBe("user-9");
  });

  it("owner-map에 없는 calId → null(공유/팀)", () => {
    expect(resolveGoogleOwnerId("team@group", {}, userIdByEmail)).toBeNull();
  });

  it("매핑된 이메일에 해당 User 없음 → null(고착 방지)", () => {
    expect(resolveGoogleOwnerId("cal-x@group", { "cal-x@group": "ghost@corp.com" }, userIdByEmail)).toBeNull();
  });
});

describe("googleSourceKey", () => {
  it("calId(이메일 형태)를 key에 노출하지 않는다(§9 — 불투명 식별자)", () => {
    const key = googleSourceKey("person@example.com");
    expect(key).not.toContain("person@example.com");
    expect(key).not.toContain("@");
    expect(key.startsWith("google:")).toBe(true);
  });

  it("같은 calId → 같은 key(결정적 — 재시드 upsert 멱등)", () => {
    expect(googleSourceKey("cal-a@group")).toBe(googleSourceKey("cal-a@group"));
  });

  it("다른 calId → 다른 key(충돌 방지)", () => {
    expect(googleSourceKey("cal-a@group")).not.toBe(googleSourceKey("cal-b@group"));
  });
});
```

`prisma/seed-google.ts`:

```ts
import { createHash } from "node:crypto";

// calId → ownerUserId. 명시적 owner-map(calId→이메일)이 있을 때만 그 이메일의 userId로 귀속, 없으면 null(공유/팀).
// Phase 3 기본은 owner-map이 비어 있어 전부 null(team) — dedup/personal-google 비활성. map을 채우면 코드 변경 없이 활성화(§10).
export function resolveGoogleOwnerId(
  calId: string,
  ownerEmailByCalId: Record<string, string>,
  userIdByEmail: Record<string, string>,
): string | null {
  const email = ownerEmailByCalId[calId];
  if (!email) return null;
  return userIdByEmail[email] ?? null;
}

// Google 소스의 CalendarSource.key를 만든다. key는 feed 응답(sourceKey·이벤트 id·sources·stale/failed)에
// 실려 UI에 노출되므로 calId(개인 캘린더면 이메일)를 내장하면 안 된다(§9 — 적대적 리뷰 5차). 실제 calId는
// externalId에만 보관한다. 해시라 결정적 → 재시드 upsert(where: { key })가 멱등하다.
export function googleSourceKey(calId: string): string {
  return `google:${createHash("sha256").update(calId).digest("hex").slice(0, 12)}`;
}
```

실행(PASS): `npm test -- tests/prisma/seed-google.test.ts`

### 2. seed.ts에서 ROLE_ALLOW import로 전환

`prisma/seed.ts` 상단 import 추가(기존 `EXTRA_PERMISSIONS` import 아래):

```ts
import { ROLE_ALLOW } from "./seed-roles";
import { resolveGoogleOwnerId, googleSourceKey } from "./seed-google";
```

그리고 기존 인라인 `const ROLE_ALLOW: Record<string, string[]> = { … };` 블록(현재 라인 24~49) **전체 삭제**. 나머지 `ACCESS_ROLES`/`NAV`/`splitKey`/`main` 로직은 그대로 둔다(ROLE_ALLOW 참조는 import로 해결됨).

### 3. CalendarSource seed 추가 (실 config — 메인 seed)

`prisma/seed.ts`의 `main()` 안, **nav 루프(step 5) 다음·`console.log` 직전**에 아래 블록을 추가한다:

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
  // 선택적 owner-map(calId→이메일). 비어 있으면 전부 team(ownerUserId=null) = Phase 3 기본. 채우면 dedup/personal-google 활성(§10).
  const ownersRow = await prisma.systemSetting.findUnique({ where: { key: "integrations.google.calendarOwners" } });
  const ownerEmailByCalId =
    ownersRow?.value && typeof ownersRow.value === "object" && !Array.isArray(ownersRow.value)
      ? (ownersRow.value as Record<string, string>)
      : {};
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const userIdByEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
  for (const calId of calIds) {
    const ownerUserId = resolveGoogleOwnerId(calId, ownerEmailByCalId, userIdByEmail);
    // key는 불투명(calId 해시) — calId(개인 캘린더면 이메일)가 feed 응답으로 새지 않게 한다(§9, 적대적 리뷰 5차).
    // 실제 calId는 externalId에만 보관(provider fetch 대상). name은 admin 식별용 DB 필드라 응답엔 미포함.
    const key = googleSourceKey(calId);
    await prisma.calendarSource.upsert({
      where: { key },
      // ownerUserId는 create·update 모두 설정 — 재seed 시 owner-map 변경이 기존 행에도 반영돼야 attribution이 고착되지 않음(적대적 리뷰).
      update: { externalId: calId, syncStatus: "ACTIVE", ownerUserId },
      create: { key, kind: "GOOGLE_CALENDAR", name: `Google: ${calId}`, provider: "google", externalId: calId, cacheTtlSeconds: 900, visibility: "TEAM", ownerUserId },
    });
  }

  // (데모 WorkflowTask/LeaveRequest는 메인 seed에 두지 않는다 — dev 전용 prisma/seed-demo.ts로 분리. step 3b.)
```

`console.log` 메시지에 `calendarSources` 한 줄을 덧붙여도 좋다(선택).

### 3b. dev 전용 데모 시드 (`prisma/seed-demo.ts`) + npm 스크립트

데모 데이터는 **메인 seed와 분리된 독립 스크립트**다. `npm run db:seed:demo`로만 실행되며 `prisma db seed`(=메인) 경로엔 포함되지 않는다.

`prisma/seed-demo.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// dev 전용 데모 데이터 — 메인 seed.ts(roles/admin/config 부트스트랩)와 분리.
// production/cutover의 `db:seed` 경로엔 절대 포함되지 않는다(가짜 승인 휴가·업무가 권위 데이터로 주입되는 것 방지 — 적대적 리뷰 Finding 1).
async function main() {
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

  // 데모 휴가는 OWNER 사용자에게 귀속(메인 seed가 먼저 만들어야 함).
  const owner = await prisma.user.findFirst({ where: { systemRole: "OWNER" } });
  if (!owner) {
    console.warn("[seed-demo] OWNER 사용자가 없어 데모 LeaveRequest를 건너뜁니다. 먼저 `npm run db:seed` 실행.");
  } else {
    await prisma.leaveRequest.upsert({
      where: { id: "sample-leave-1" },
      update: {},
      create: { id: "sample-leave-1", userId: owner.id, leaveType: "ANNUAL", startDate: new Date(now.getFullYear(), now.getMonth(), 15), endDate: new Date(now.getFullYear(), now.getMonth(), 16), days: 2, status: "APPROVED", reason: "데모 연차" },
    });
  }

  console.log("[seed-demo] 데모 WorkflowTask/LeaveRequest seed 완료(dev 전용).");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

`package.json` scripts에 추가:

```json
"db:seed:demo": "tsx prisma/seed-demo.ts"
```

### 4. commit

```
git add prisma/seed-roles.ts prisma/seed-demo.ts prisma/seed.ts package.json tests/prisma/seed-roles.test.ts
git commit -m "seed: grant contractors calendar.leave:view; seed holiday/google sources; split demo data into dev-only seed-demo"
```

## Acceptance Criteria

- `npm test -- tests/prisma/seed-roles.test.ts tests/prisma/seed-google.test.ts` → PASS(외주 권한 + Google owner resolver).
- `npm run prisma:validate` → 스키마 유효(변경 없음).
- `npm run typecheck` / `npm run lint` → OK.
- (DB 연결 시) `npm run db:seed` → 오류 없이 CalendarSource(holiday-kr 등) 생성. owner-map이 있으면 매핑된 Google 소스에 `ownerUserId` 설정(없으면 null=team). **데모 task/leave는 생성하지 않는다**(메인 seed에서 분리됨).
- (DB 연결 시, dev 전용) `npm run db:seed:demo` → 데모 task/leave 생성. **production/cutover에선 실행하지 않는다.** 이 DB 검증은 node 단위 테스트 범위 밖이며 dev DB(터널)에서 수동 확인한다.

## Cautions

- **seed.ts를 테스트에서 직접 import하지 말 것.** 이유: 최상위 `main()`이 실행되어 DB 연결을 시도한다. 권한 매트릭스 검증은 부수효과 없는 `seed-roles.ts`만 import한다.
- **데모 LeaveRequest/WorkflowTask를 메인 `seed.ts`(=`prisma db seed`)에 두지 말 것.** 이유: 메인 seed는 roles/admin/config 부트스트랩 경로라 cutover·production 재시드 시 가짜 **승인 휴가**(캘린더 이벤트·dedup 앵커·연차/정산 입력이 됨)·업무가 권위 데이터로 주입된다(적대적 리뷰 Finding 1). 고정 id만으론 중복만 막고 오염은 못 막는다. 반드시 `prisma/seed-demo.ts`(dev 전용, `db:seed:demo`)로 분리한다.
- **source key는 `googleSourceKey(calId)`(calId의 결정적 해시)로 만들 것 — calId를 key에 그대로 박지 말 것.** 이유 ①(유출): key는 `sourceKey`·이벤트 `id`·`sources`·stale/failed로 응답에 노출되므로, calId(개인 캘린더면 이메일)를 내장하면 타이틀 마스킹과 무관하게 누설된다(§9, 적대적 리뷰 5차). 이유 ②(멱등): 키는 calId에 대해 **결정적**이어야 재seed 시 calId 순서가 바뀌어도 동일 source에 매핑된다(인덱스/순서 기반 키 금지). 무작위 slug는 upsert 멱등성을 깨므로 안 된다. 실제 calId는 `externalId`에만 보관한다.
- **Google 소스 `ownerUserId`를 create에만 넣고 update에 빠뜨리지 말 것.** 이유: 재seed 시 owner-map이 바뀌어도 기존 행이 갱신 안 되면 attribution이 고착된다(적대적 리뷰). create·update 모두 설정한다.
- **owner-map이 비어 dedup/personal-google이 비활성인 것은 의도된 Phase 3 기본임(인지).** 이유: 개인별 Google 캘린더 dedup이 필요해지면 `integrations.google.calendarOwners`만 채우면 코드 변경 없이 활성화된다(§10). 기본은 공유/팀 캘린더만 가정.
