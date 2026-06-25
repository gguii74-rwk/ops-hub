# task-03 — 연차 서비스 알림 게이트

`createLeaveRequest`/`approve`/`reject`가 enqueue 직전 토글 설정을 읽어, OFF면 `mailJob = null`을 repository에 넘긴다(기존 `if (mailJob)` 가드가 자동 스킵). repository·트랜잭션·발송 워커 **무변경**. `createLeaveRequestByAdmin`은 **변경 없음**(D3).

## Files

- Modify: `src/modules/leave/services/requests.ts` — `getSetting` import + `notificationsEnabled` 헬퍼 + 3개 함수 게이트.
- Test: `tests/modules/leave/mail-wiring.test.ts` — `@/kernel/settings/reader` 모킹 추가 + OFF 케이스 추가.
- Test: `tests/modules/leave/requests-service.test.ts` — `@/kernel/settings/reader` 모킹 1줄 추가(크래시 방지).

## Prep

- 읽기: 엔트리포인트 §SC-1(키), §SC-2(게이트 의미론·헬퍼 코드), §SC-5(테스트 영향).
- 사전 조사 사실: repository `createPendingRequest`/`approveTx`/`rejectRequest`는 모두 `mailJob?: MailJob | null`을 받아 `if (mailJob)`일 때만 `insertPendingDelivery` → 서비스가 `null`만 넘기면 enqueue 자동 스킵.
- `getSetting`은 키 미등록 시 `UnknownSettingError`를 던진다 → task-01이 3키를 등록해야 런타임에서 정상 동작. 그래서 **deps: 01**.

## Deps

01 (3키가 카탈로그에 등록돼야 `getSetting`이 `UnknownSettingError` 없이 동작).

## TDD steps

### Step 1 — 테스트 갱신(실패 확인)

#### (a) `tests/modules/leave/mail-wiring.test.ts`

상단 mock 블록에 reader 모킹을 추가한다. 기존 `vi.hoisted(...)` 블록을 확장:

기존:
```ts
const { getLeaveAdminRecipients, triggerLeaveMailDrain, userFindUnique } = vi.hoisted(() => ({
  getLeaveAdminRecipients: vi.fn(async () => ["admin@x.com"] as string[]),
  triggerLeaveMailDrain: vi.fn(),
  userFindUnique: vi.fn(),
}));
vi.mock("@/modules/leave/services/mail", () => ({ getLeaveAdminRecipients, triggerLeaveMailDrain }));
```

→ 변경(getSetting 추가 + reader 모킹):
```ts
const { getLeaveAdminRecipients, triggerLeaveMailDrain, userFindUnique, getSetting } = vi.hoisted(() => ({
  getLeaveAdminRecipients: vi.fn(async () => ["admin@x.com"] as string[]),
  triggerLeaveMailDrain: vi.fn(),
  userFindUnique: vi.fn(),
  getSetting: vi.fn(async () => true as unknown),
}));
vi.mock("@/modules/leave/services/mail", () => ({ getLeaveAdminRecipients, triggerLeaveMailDrain }));
vi.mock("@/kernel/settings/reader", () => ({ getSetting }));
```

`beforeEach`에 기본값 리셋 1줄 추가(`requirePermissionForTarget.mockResolvedValue(undefined);` 다음 줄):
```ts
  getSetting.mockResolvedValue(true);
```

`describe("createLeaveRequest mail wiring", ...)` 블록 끝에 OFF 케이스 추가:
```ts
  it("onRequest OFF → mailJob null + createPendingRequest(null) + triggerLeaveMailDrain 미호출", async () => {
    getSetting.mockResolvedValue(false);
    repo.findActiveAllocation.mockResolvedValue({ allocatedDays: 15, carriedOverDays: 0, usedDays: 0 } as any);
    repo.findOverlap.mockResolvedValue(null);
    repo.createPendingRequest.mockResolvedValue({ id: "r1" } as any);
    await createLeaveRequest("u1", input);
    const [, mailJob] = repo.createPendingRequest.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(getSetting).toHaveBeenCalledWith("leave.notifications.onRequest");
    expect(triggerLeaveMailDrain).not.toHaveBeenCalled();
  });
```

`describe("approve/reject mail wiring (pre-flight #4)", ...)` 블록 끝에 OFF 케이스 2개 추가:
```ts
  it("onApprove OFF → approveTx에 mailJob null(triggerLeaveMailDrain backstop 호출은 유지)", async () => {
    getSetting.mockResolvedValue(false);
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    repo.approveTx.mockResolvedValue(undefined as any);
    await approve("r1", "admin1");
    const [, , mailJob] = repo.approveTx.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(getSetting).toHaveBeenCalledWith("leave.notifications.onApprove");
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
  it("onReject OFF → rejectRequest에 mailJob null(triggerLeaveMailDrain 유지)", async () => {
    getSetting.mockResolvedValue(false);
    repo.getRequestById.mockResolvedValue({
      id: "r1", userId: "u1", leaveType: "ANNUAL", leaveSubType: null, quarterStartTime: null,
      startDate: new Date("2999-08-14T00:00:00Z"), endDate: new Date("2999-08-14T00:00:00Z"), reason: null,
    } as any);
    userFindUnique.mockResolvedValue({ email: "u@x.com", teamId: "t1" });
    repo.rejectRequest.mockResolvedValue(undefined as any);
    await reject("r1", "admin1", "사유");
    const [, , , mailJob] = repo.rejectRequest.mock.calls[0];
    expect(mailJob).toBeNull();
    expect(getSetting).toHaveBeenCalledWith("leave.notifications.onReject");
    expect(triggerLeaveMailDrain).toHaveBeenCalledTimes(1);
  });
```

`describe("createLeaveRequestByAdmin mail wiring", ...)` 블록 끝에 D3 회귀 가드 추가:
```ts
  it("관리자 직접등록은 토글 무관 — getSetting 미조회(D3), sendNotification만 따름", async () => {
    getSetting.mockResolvedValue(false); // 토글 OFF여도
    repo.findOverlap.mockResolvedValue(null);
    repo.createApprovedRequestTx.mockResolvedValue({ id: "r1" } as any);
    userFindUnique.mockResolvedValue({ email: "target@x.com", status: "ACTIVE", teamId: "t1" });
    await createLeaveRequestByAdmin("admin1", "u2", input, null, true);
    const [, mailJob] = repo.createApprovedRequestTx.mock.calls[0];
    expect(mailJob).toEqual(expect.objectContaining({ recipients: ["target@x.com"] }));
    expect(getSetting).not.toHaveBeenCalled();
  });
```

#### (b) `tests/modules/leave/requests-service.test.ts`

`@/modules/leave/authz` 모킹 줄 **다음**(line 24 부근)에 reader 모킹 1줄 추가:
```ts
vi.mock("@/kernel/settings/reader", () => ({ getSetting: vi.fn(async () => true) }));
```

이 파일은 알림을 검증하지 않으므로 기본 true 모킹만으로 충분(real getSetting이 미모킹 prisma를 호출해 크래시하는 것 방지).

실행(FAIL 기대 — 게이트 미구현이라 OFF 케이스에서 mailJob이 여전히 빌드됨):
```bash
npx vitest run tests/modules/leave/mail-wiring.test.ts tests/modules/leave/requests-service.test.ts
```

### Step 2 — requests.ts 게이트 구현

`src/modules/leave/services/requests.ts`를 아래 3곳 수정.

#### (2-1) import 추가

`import { assertTargetUser } from "../authz";` **다음** 줄에 추가:
```ts
import { getSetting } from "@/kernel/settings/reader"; // 모듈 경계 허용 read-only facade
```

#### (2-2) 헬퍼 추가

`toMailJob` 정의 **다음**, `spannedYears` **앞**에 추가:
```ts
// 알림 토글 — 명시적 false일 때만 끈다(기본 ON 보존, D4). 조회 실패(인프라 장애)도 발송 유지(D4 fallbackSafe).
async function notificationsEnabled(key: string): Promise<boolean> {
  try {
    return (await getSetting(key)) !== false;
  } catch (e) {
    console.warn(`[leave] 알림 설정 조회 실패(${key}) — 발송 유지:`, e);
    return true;
  }
}
```

#### (2-3) createLeaveRequest 게이트

`createLeaveRequest`의 `applicant` 조회 ~ `return created;` 구간(현재 53~65행)을 아래로 교체한다. **앞부분(날짜·공휴일·할당·중복 검증)은 그대로** 둔다 — `if (await findOverlap...)` 다음부터:

```ts
  const notify = await notificationsEnabled("leave.notifications.onRequest");
  let mailJob: MailJob | null = null;
  if (notify) {
    const applicant = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, teamId: true } });
    // enqueue 스냅샷: REQUESTED 행을 항상 적재하기 위한 durable 기록. 단 **실제 발송 수신자 결정의 SSOT는 drain**이며,
    // worker가 REQUESTED 발송 직전 getLeaveAdminRecipients()로 재확정한다(결정 A) — claim~발송 사이 권한 변동 반영.
    const recipients = await getLeaveAdminRecipients(applicant?.teamId ?? null);
    const reqLike: MailReqLike = { leaveType: input.leaveType, leaveSubType: input.leaveSubType ?? null, quarterStartTime: input.quarterStartTime ?? null, startDate: start, endDate: end, reason: input.reason ?? null };
    // 수신자 0명(승인권한자 없음/조회 저하)이어도 REQUESTED 행은 적재 — durable 기록(spec §8). 단 토글 OFF는 "보내지 않기로 한 결정"이라 적재 자체를 스킵(D2).
    mailJob = toMailJob(recipients, buildRequestNotification(applicant?.name ?? "직원", reqLike));
  }
  const created = await createPendingRequest({
    userId, leaveType: input.leaveType, leaveSubType: input.leaveSubType,
    quarterStartTime: input.quarterStartTime, startDate: start, endDate: end, days, reason: input.reason,
  }, mailJob);
  if (mailJob) triggerLeaveMailDrain();
  return created;
}
```

#### (2-4) approve 게이트

`approve`의 `const mailJob = ...` 줄을 교체:

기존:
```ts
  const mailJob = user?.email ? toMailJob([user.email], buildApprovedNotification(req)) : null;
```
→
```ts
  const notify = await notificationsEnabled("leave.notifications.onApprove");
  const mailJob = notify && user?.email ? toMailJob([user.email], buildApprovedNotification(req)) : null;
```
(`triggerLeaveMailDrain();`는 **그대로 무조건 호출** — backstop 보존.)

#### (2-5) reject 게이트

`reject`의 `const mailJob = ...` 줄을 교체:

기존:
```ts
  const mailJob = user?.email ? toMailJob([user.email], buildRejectedNotification(req, rejectionReason)) : null;
```
→
```ts
  const notify = await notificationsEnabled("leave.notifications.onReject");
  const mailJob = notify && user?.email ? toMailJob([user.email], buildRejectedNotification(req, rejectionReason)) : null;
```
(`triggerLeaveMailDrain();`는 그대로 무조건 호출.)

> `createLeaveRequestByAdmin`은 손대지 않는다(D3).

실행(PASS 기대):
```bash
npx vitest run tests/modules/leave/mail-wiring.test.ts tests/modules/leave/requests-service.test.ts
```

### Step 3 — 검증 + 커밋

```bash
npm run typecheck
npm run lint
npm test
```

`lint`는 boundaries(`module→kernel/settings/reader` 허용 — restricted-imports에 reader 미포함)를 통과해야 한다. 전부 통과하면 커밋:

```bash
git add src/modules/leave/services/requests.ts tests/modules/leave/mail-wiring.test.ts tests/modules/leave/requests-service.test.ts
git commit -m "feat(leave): 신청/승인/반려 알림 메일 enqueue 토글 게이트"
```

## Acceptance Criteria

- `npx vitest run tests/modules/leave/mail-wiring.test.ts` — ON(기존 8케이스 무손상) + OFF 3케이스(onRequest/onApprove/onReject) + D3 회귀 통과.
- `npx vitest run tests/modules/leave/requests-service.test.ts` — 회귀 없음(reader 모킹으로 크래시 방지).
- `npm run lint` — boundaries 위반 없음(`@/kernel/settings/reader`만 import).
- `npm run typecheck` / `npm test` — 전체 그린.

## Cautions

- **`@/kernel/settings/service`·`/index`·`/catalog` 등에서 import 금지.** 모듈은 `@/kernel/settings/reader`만 허용(eslint restricted-imports). reader가 `getSetting`을 re-export한다.
- **명시적 `=== false` / `!== false` 비교를 써라.** `getSetting` 반환은 `unknown`. truthy 판정(`if (enabled)`)은 타입상 위험하고 D4("명시적 false일 때만 끈다")에 어긋난다.
- **approve/reject의 `triggerLeaveMailDrain()`을 조건부로 바꾸지 마라.** 기존 backstop 동작(이메일 없을 때도 호출)을 보존해야 `mail-wiring.test.ts`의 "신청자 이메일 없으면 mailJob null이지만 triggerLeaveMailDrain은 호출" 테스트가 그린. `createLeaveRequest`만 `if (mailJob)`로 조건부(거긴 기존에 항상 non-null이었음).
- **repository를 건드리지 마라.** 게이트는 서비스 계층 enqueue 시점 한 곳. `if (mailJob)` 가드는 이미 repository에 있다.
- **`createLeaveRequestByAdmin`을 게이트하지 마라**(D3). 중복 게이트는 codex가 "토글 누락"으로 오인할 수 있으나 의도된 결정이다.
