# Task 02 — detail `effectiveRecipients` (`:send` 게이트, §6·F3)

상세 조회 응답에 발송 모달 prefill용 `effectiveRecipients`를 **`:send` 권한자에게만** read-only로 노출한다. 전이/쓰기 없음(D1). 라우트 변경 없음.

## Files

- Modify: `src/modules/workflows/repositories/index.ts` — `findTaskDetail`(recipients·defaultRecipients select), `TaskDetailRow` 인터페이스
- Modify: `src/modules/workflows/services/tasks.ts` — `TaskDetailView`(effectiveRecipients?), `getTaskDetailView`(게이트)
- Modify (test): `tests/modules/workflows/tasks-service.test.ts`

## Prep

- 엔트리포인트 §SC-2 ①, §SC-4 숙지. 값 우선순위: `task.recipients`(비어있지 않으면) → `type.defaultRecipients` → `[]`.
- 게이트는 **keys 기반**(`ctx.permissionKeys.has(`${KIND_RESOURCE[kind]}:send`)`) — 기존 `:view` 게이트와 동일 방식(detail 라우트는 isOwner를 안 넘김). 최소정보 원칙: `:view`-only는 노출 안 함.

## Deps

없음.

## TDD steps

### Step 1 — tasks-service 테스트에 게이트·폴백 케이스 추가 (RED)

`tests/modules/workflows/tasks-service.test.ts`:

1) 기존 `const detail = {...}` 픽스처에 두 필드 추가(타입 일치):
```ts
    createdById: "u1", outputPath: null, recipients: null, defaultRecipients: null,
```

2) `describe("getTaskDetailView")` 안에 케이스 추가:
```ts
  it(":send 없으면 effectiveRecipients 미포함(:view-only 비노출, F3)", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: ["a@x"], defaultRecipients: ["b@x"] });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view"]) });
    expect(out!.effectiveRecipients).toBeUndefined();
  });

  it(":send 있으면 task.recipients 우선", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: ["a@x"], defaultRecipients: ["b@x"] });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual(["a@x"]);
  });

  it(":send 있고 task.recipients 비면(null) type.defaultRecipients", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: null, defaultRecipients: ["b@x"] });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual(["b@x"]);
  });

  it(":send 있고 둘 다 없으면 []", async () => {
    m.findTaskDetail.mockResolvedValue({ ...detail, recipients: null, defaultRecipients: null });
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view", "workflows.weekly:send"]) });
    expect(out!.effectiveRecipients).toEqual([]);
  });
```

Run: `npm test -- tests/modules/workflows/tasks-service.test.ts` → **FAIL**(`effectiveRecipients` 미존재).

### Step 2 — repository `findTaskDetail`에 recipients·defaultRecipients 추가

`src/modules/workflows/repositories/index.ts`:

1) `TaskDetailRow` 인터페이스에 두 필드 추가:
```ts
export interface TaskDetailRow {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: Date; status: WorkflowStatus;
  createdById: string | null; outputPath: string | null;
  recipients: string[] | null; defaultRecipients: string[] | null;
  files: FileRow[]; mailDeliveries: MailRow[]; events: EventRow[];
}
```

2) `findTaskDetail`의 `select`에 `recipients: true`(top-level)와 `type.select`에 `defaultRecipients: true` 추가, 반환에 매핑:
```ts
export async function findTaskDetail(id: string): Promise<TaskDetailRow | null> {
  const t = await prisma.workflowTask.findUnique({
    where: { id },
    select: {
      id: true, scheduledAt: true, status: true, createdById: true, outputPath: true, recipients: true,
      type: { select: { kind: true, name: true, defaultRecipients: true } },
      files: { select: { id: true, path: true, displayName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      mailDeliveries: {
        select: { id: true, step: true, recipients: true, subject: true, status: true, errorMessage: true, providerMessageId: true, sentAt: true },
        orderBy: { sentAt: "desc" },
      },
      events: { select: { id: true, fromStatus: true, toStatus: true, actorId: true, note: true, occurredAt: true }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!t) return null;
  return {
    id: t.id, kind: t.type.kind, typeName: t.type.name, scheduledAt: t.scheduledAt, status: t.status,
    createdById: t.createdById, outputPath: t.outputPath,
    recipients: Array.isArray(t.recipients) ? (t.recipients as string[]) : null,
    defaultRecipients: Array.isArray(t.type.defaultRecipients) ? (t.type.defaultRecipients as string[]) : null,
    files: t.files, mailDeliveries: t.mailDeliveries, events: t.events,
  };
}
```

### Step 3 — service `getTaskDetailView` 게이트

`src/modules/workflows/services/tasks.ts`:

1) `TaskDetailView` 인터페이스에 추가:
```ts
export interface TaskDetailView {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
  effectiveRecipients?: string[]; // :send 권한자에게만(§6, F3). 없으면 필드 생략.
}
```

2) `getTaskDetailView` 반환을 변수에 담고, `:send`일 때만 필드 추가:
```ts
  if (!ctx.permissionKeys.has(`${KIND_RESOURCE[t.kind]}:view`)) throw new ForbiddenError("열람 권한이 없습니다.");
  const view: TaskDetailView = {
    id: t.id,
    kind: t.kind,
    typeName: t.typeName,
    scheduledAt: t.scheduledAt.toISOString(),
    status: t.status,
    files: t.files.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes != null ? Number(f.sizeBytes) : null,
      createdAt: f.createdAt.toISOString(),
    })),
    mailDeliveries: t.mailDeliveries.map((mm) => ({
      id: mm.id,
      step: mm.step,
      recipients: Array.isArray(mm.recipients) ? (mm.recipients as string[]) : [],
      subject: mm.subject,
      status: mm.status,
      errorMessage: mm.errorMessage,
      sentAt: mm.sentAt ? mm.sentAt.toISOString() : null,
    })),
    timeline: t.events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId,
      note: e.note,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
  // :send 권한자에게만 prefill 재료를 노출(§6, F3). task.recipients(비어있지 않으면) → type.defaultRecipients → [].
  if (ctx.permissionKeys.has(`${KIND_RESOURCE[t.kind]}:send`)) {
    view.effectiveRecipients = t.recipients && t.recipients.length > 0 ? t.recipients : (t.defaultRecipients ?? []);
  }
  return view;
```

Run: `npm test -- tests/modules/workflows/tasks-service.test.ts` → **PASS**.

## Acceptance Criteria

- `npm test -- tests/modules/workflows/tasks-service.test.ts` → PASS(신규 4케이스 포함).
- `npm run typecheck` → 0 errors.
- `npm run lint` → boundaries 위반 없음.
- 전체 `npm test` → 회귀 0(기존 "권한 있으면 DTO 직렬화"는 `:send` 없어 effectiveRecipients undefined — 영향 없음).

## Cautions

- **Don't** detail 라우트(`[id]/route.ts`)를 바꾸지 말 것 — 이미 `permissionKeys`를 넘긴다. 게이트는 서비스 내부 1곳.
- **Don't** `:view`-only 사용자에게 기본 수신자를 노출하지 말 것(이메일 누출 — 최소정보 원칙). 필드 자체를 생략한다(빈 배열로 항상 포함 금지).
- **Don't** `recipients: []`(빈 배열)를 "지정됨"으로 취급하지 말 것 — `length > 0`이 아니면 `defaultRecipients`로 폴백(§6 "비어있지 않으면").
