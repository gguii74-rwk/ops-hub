# Task 07 — 상세 API: MailView cc/bcc·bcc 게이트(D14)·effectiveRecipients 맵(D8)

상세 이력에 cc(전원)·bcc(`:send`만)를 직렬화하고, `effectiveRecipients`를 flat `string[]`에서 **단계별 enrich 맵**으로 교체한다.

## Files
- Modify: `src/modules/workflows/repositories/index.ts` (`MailRow`·`TaskDetailRow`·`findTaskDetail`)
- Modify: `src/modules/workflows/services/tasks.ts` (`MailView`·`TaskDetailView`·`getTaskDetailView`)
- Test: `tests/modules/workflows/tasks-service.test.ts` (effectiveRecipients 케이스 교체 + D14 케이스)
- Test: `tests/modules/workflows/repository.test.ts` (findTaskDetail 케이스 보강)

## Prep
- 엔트리포인트 §SC-2(타입), §SC-3(`sendStepsForKind`), §SC-7(상세 계약), §SC-8(`findContactNamesByEmails` — task-06 산출).
- 참조: `tests/modules/workflows/tasks-service.test.ts` 52~103행(기존 detail mock·effectiveRecipients 케이스 — 교체 대상).

## Deps
- Task 01(recipients.ts·policy), Task 03(MailDelivery cc/bcc 컬럼 소비 시작), Task 06(`repositories/mail-recipients.ts`).

## Cautions
- **Don't view-only 응답에 `bcc: []`처럼 빈 값으로라도 필드를 넣지 마라.** Reason: D14 — **필드 생략**이 계약(존재 여부 자체가 신호). cc는 view 허용(null→[]).
- **Don't effectiveRecipients를 주소록 전체 조인으로 만들지 마라.** Reason: backend-minimal-data — 세트에 등장한 email만 `findContactNamesByEmails`로 조회.
- **Don't `effectiveRecipients`의 flat `string[]` 형태를 하위호환으로 남기지 마라.** Reason: D8 — 소비처는 발송 모달뿐, 동시 교체(task-08). 이중 형태는 drift.
- **Don't `TaskDetailRow`에 task `recipients`를 남기지 마라.** Reason: D5 — 死필드 select 제거(컬럼 보존).

## TDD Steps

### 1. repository — 실패 테스트 먼저

`tests/modules/workflows/repository.test.ts`의 `describe("findTaskDetail")`의 "type·files·mail·events를 평탄화해 반환" 케이스에서 mock의 `mailDeliveries` 행에 `cc: ["c@x"], bcc: null,`을 추가하고, `type`을 `{ kind: "WEEKLY_REPORT", name: "주간보고", defaultRecipients: { "1": { to: ["a@x"], cc: [], bcc: [] } } }`로 바꾼 뒤 단언을 추가:

```ts
    expect(out?.mailDeliveries[0].cc).toEqual(["c@x"]);
    expect(out?.mailDeliveries[0].bcc).toBeNull();
    expect(out?.defaultRecipients).toEqual({ "1": { to: ["a@x"], cc: [], bcc: [] } });
    expect("recipients" in (out as object)).toBe(false); // D5 — 死필드 select 제거
```

실행: `npm test -- tests/modules/workflows/repository.test.ts` → **FAIL**.

### 2. repository 구현 — `src/modules/workflows/repositories/index.ts`

(task-04에서 이미 `parseDefaultRecipients` import 존재.) `MailRow`·`TaskDetailRow`를 교체:

```ts
export interface MailRow {
  id: string; step: string | null; recipients: unknown; cc: unknown; bcc: unknown; subject: string;
  status: MailDeliveryStatus; errorMessage: string | null; providerMessageId: string | null; sentAt: Date | null;
}
```

```ts
export interface TaskDetailRow {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: Date; status: WorkflowStatus;
  createdById: string | null; outputPath: string | null;
  defaultRecipients: DefaultRecipientsMap | null; // D5: task.recipients는 死필드 — select·타입에서 제거(컬럼 보존)
  files: FileRow[]; mailDeliveries: MailRow[]; events: EventRow[];
}
```

`findTaskDetail`의 select에서 task 레벨 `recipients: true`를 **제거**, `mailDeliveries` select에 `cc: true, bcc: true,` 추가(recipients 다음). 반환 매핑에서 `recipients:` 줄을 제거하고 `defaultRecipients`를 교체:

```ts
    defaultRecipients: parseDefaultRecipients(t.type.defaultRecipients),
```

실행: `npm test -- tests/modules/workflows/repository.test.ts` → **PASS**.

### 3. service — 실패 테스트 먼저

`tests/modules/workflows/tasks-service.test.ts` 수정.

파일 상단 mock 블록에 mail-recipients 레포 mock 추가(기존 repositories mock 다음):

```ts
vi.mock("@/modules/workflows/repositories/mail-recipients", () => ({
  findContactNamesByEmails: vi.fn(async () => new Map<string, string>()),
}));
```

import에 추가:

```ts
import * as contactRepo from "@/modules/workflows/repositories/mail-recipients";
const cm = contactRepo as unknown as Record<string, ReturnType<typeof vi.fn>>;
```

`beforeEach`에 `cm.findContactNamesByEmails.mockReset().mockResolvedValue(new Map());` 추가.

`describe("getTaskDetailView")`의 `detail` fixture를 새 구조로 교체:

```ts
  const detail = {
    id: "t1", kind: "BILLING", typeName: "대금청구", scheduledAt: new Date("2026-06-12T00:00:00Z"), status: "GENERATED",
    createdById: "u1", outputPath: null,
    defaultRecipients: { "1": { to: ["a@x.com"], cc: ["c@x.com"], bcc: ["b@x.com"] } },
    files: [{ id: "f1", path: "/o/a.xlsx", displayName: "a.xlsx", mimeType: null, sizeBytes: 123n, createdAt: new Date("2026-06-12T00:00:00Z") }],
    mailDeliveries: [{ id: "m1", step: "1", recipients: ["a@x"], cc: ["c@x"], bcc: ["b@x"], subject: "s", status: "FAILED", errorMessage: "boom", providerMessageId: null, sentAt: null }],
    events: [{ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: new Date("2026-06-12T00:00:00Z") }],
  };
```

기존 effectiveRecipients 4케이스(81~102행: ":send 없으면 미포함" / "task.recipients 우선" / "type 폴백" / "빈 배열")를 **아래로 교체**(권한 키는 kind=BILLING에 맞춰 `workflows.billing:*`):

```ts
  it(":send 없으면 effectiveRecipients 미포함 + mail bcc 필드 부재(D8·D14)", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view"]) });
    expect(out!.effectiveRecipients).toBeUndefined();
    expect(out!.mailDeliveries[0].cc).toEqual(["c@x"]);            // cc는 view 허용
    expect("bcc" in out!.mailDeliveries[0]).toBe(false);           // bcc는 필드 생략
    expect(cm.findContactNamesByEmails).not.toHaveBeenCalled();
  });

  it(":send 보유 → mail bcc 포함 + effectiveRecipients 단계별 맵(미저장 step은 빈 필드)", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    cm.findContactNamesByEmails.mockResolvedValue(new Map([["a@x.com", "홍길동"]]));
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view", "workflows.billing:send"]) });
    expect(out!.mailDeliveries[0].bcc).toEqual(["b@x"]);
    expect(out!.effectiveRecipients).toEqual({
      "1": { to: [{ email: "a@x.com", name: "홍길동" }], cc: [{ email: "c@x.com" }], bcc: [{ email: "b@x.com" }] },
      "2": { to: [], cc: [], bcc: [] },
    });
  });

  it("enrich는 세트 등장 email만 조회(주소록 전체 미노출)", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view", "workflows.billing:send"]) });
    const [emails] = cm.findContactNamesByEmails.mock.calls[0] as [string[]];
    expect([...emails].sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("발송 step 없는 kind(WEEKLY_REPORT)는 빈 맵", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, kind: "WEEKLY_REPORT", defaultRecipients: null });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual({});
  });

  it("기존 행(cc/bcc null) → cc []·bcc [](:send 기준) 호환", async () => {
    m.findTaskDetail.mockResolvedValue({
      ...detail,
      mailDeliveries: [{ ...detail.mailDeliveries[0], cc: null, bcc: null }],
    });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view", "workflows.billing:send"]) });
    expect(out!.mailDeliveries[0].cc).toEqual([]);
    expect(out!.mailDeliveries[0].bcc).toEqual([]);
  });
```

주의: 같은 describe의 다른 기존 케이스가 `detail` fixture(kind WEEKLY_REPORT·`recipients` 필드)를 참조하면 새 fixture(kind BILLING·권한 키 `workflows.billing:view`)에 맞게 mock 권한 키만 조정한다(내용 단언은 불변).

실행: `npm test -- tests/modules/workflows/tasks-service.test.ts` → **FAIL**.

### 4. service 구현 — `src/modules/workflows/services/tasks.ts`

import 갱신:

```ts
import { KIND_RESOURCE, sendStepsForKind } from "../policy";
import { findTaskList, findTaskDetail } from "../repositories";
import { findContactNamesByEmails } from "../repositories/mail-recipients";
import type { DefaultRecipientsMap, EffectiveRecipientsMap, RecipientEntry } from "../recipients";
```

`MailView`·`TaskDetailView`를 교체:

```ts
export interface MailView {
  id: string; step: string | null; recipients: string[]; cc: string[]; bcc?: string[];
  subject: string; status: MailDeliveryStatus; errorMessage: string | null; sentAt: string | null;
}
export interface TaskDetailView {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: EffectiveRecipientsMap; // :send 권한자에게만(D8) — 단계별 {to,cc,bcc} enrich 맵. 없으면 필드 생략.
}
```

파일 하단(또는 `getTaskDetailView` 앞)에 헬퍼 추가:

```ts
const asEmails = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

// D8: type.defaultRecipients에서 파생한 단계별 맵 + 주소록 조인 enrich.
// 세트에 등장한 email만 조회(주소록 전체 미노출 — backend-minimal-data). 미저장 step은 빈 필드.
async function buildEffectiveRecipients(kind: WorkflowKind, map: DefaultRecipientsMap | null): Promise<EffectiveRecipientsMap> {
  const steps = sendStepsForKind(kind);
  const fields = (s: string) => map?.[s] ?? { to: [], cc: [], bcc: [] };
  const emails = [...new Set(steps.flatMap((s) => { const f = fields(s); return [...f.to, ...f.cc, ...f.bcc]; }))];
  const names = emails.length > 0 ? await findContactNamesByEmails(emails) : new Map<string, string>();
  const enrich = (list: string[]): RecipientEntry[] =>
    list.map((email) => { const name = names.get(email.toLowerCase()); return name ? { email, name } : { email }; });
  const out: EffectiveRecipientsMap = {};
  for (const s of steps) { const f = fields(s); out[s] = { to: enrich(f.to), cc: enrich(f.cc), bcc: enrich(f.bcc) }; }
  return out;
}
```

`getTaskDetailView`에서 권한 판정을 앞으로 빼고 `mailDeliveries` 매핑·말미 블록을 교체:

```ts
  const canSend = ctx.permissionKeys.has(`${KIND_RESOURCE[t.kind]}:send`);
```

```ts
    mailDeliveries: t.mailDeliveries.map((mm) => {
      const m: MailView = {
        id: mm.id,
        step: mm.step,
        recipients: asEmails(mm.recipients),
        cc: asEmails(mm.cc), // 공개 헤더 — view 허용(D14)
        subject: mm.subject,
        status: mm.status,
        errorMessage: mm.errorMessage,
        sentAt: mm.sentAt ? mm.sentAt.toISOString() : null,
      };
      if (canSend) m.bcc = asEmails(mm.bcc); // D14: 은닉 envelope — :send 권한자 응답에만 필드 포함
      return m;
    }),
```

기존 말미의 effectiveRecipients 블록(":send 권한자에게만 prefill 재료…")을 교체:

```ts
  // :send 권한자에게만 prefill 재료를 노출(D8). 단계별 {to,cc,bcc} + 주소록 이름 enrich.
  if (canSend) {
    view.effectiveRecipients = await buildEffectiveRecipients(t.kind, t.defaultRecipients);
  }
```

실행: `npm test -- tests/modules/workflows/tasks-service.test.ts` → **PASS**.

### 5. 게이트 검증 + 커밋

```bash
npm run typecheck && npm run lint && npm test -- tests/modules/workflows/tasks-service.test.ts tests/modules/workflows/repository.test.ts tests/app/api/workflows/routes.test.ts
```

주의: 이 시점에 `workflow-detail.tsx`/`send-modal.tsx`(구 flat 소비)는 **typecheck가 깨질 수 있다** — `effectiveRecipients?: string[]` 로컬 interface는 구조적으로 새 맵과 불일치. 로컬 UI interface는 클라 파일 소유이므로 typecheck가 깨지는 경우에만 task-08을 즉시 이어서 실행한다(같은 PR 내 — 이 태스크 단독 머지 금지). typecheck green이면 그대로 커밋.

## Acceptance Criteria
- `npm run typecheck`(task-08 완료 후 기준 green) / `npm run lint` → 통과.
- `npm test -- tests/modules/workflows/tasks-service.test.ts tests/modules/workflows/repository.test.ts` → 통과.
- view-only 응답: `bcc` 필드 부재(빈 배열 아님) + `effectiveRecipients` 부재 + 주소록 조회 0회.
- `:send` 응답: `bcc` 포함, effectiveRecipients = sendStepsForKind 파생 단계별 맵(미저장 step 빈 필드, enrich 반영).
