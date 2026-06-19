# Task 07 — tasks read service + generator 헬퍼

목록·상세를 권한에 맞게 조립해 DTO로 직렬화하는 read service와, `GeneratorResult`를 `GeneratedFile`로 기록하는 헬퍼를 만든다.

## Files

- Create: `src/modules/workflows/services/tasks.ts`
- Create: `src/modules/workflows/services/generator.ts`
- Create (test): `tests/modules/workflows/tasks-service.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-4**(repo `findTaskList`/`findTaskDetail`/`createGeneratedFiles`), **SC-6**(service 시그니처·DTO), **SC-3**(`KIND_RESOURCE`).
- Spec §9(목록은 보유 kind만), §10(timeline은 `WorkflowTaskEvent`), §11(generator 헬퍼).
- 권한 키: 목록·상세 = `workflows.<kind>:view`. OWNER는 `getPermissionSummary`가 전체 키를 주므로 별도 분기 불필요.

## Deps

- Task 02(types/policy), Task 03(repository).

## Step 1 — 실패 테스트

생성: `tests/modules/workflows/tasks-service.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/modules/workflows/repositories", () => ({
  findTaskList: vi.fn(),
  findTaskDetail: vi.fn(),
  createGeneratedFiles: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import * as repo from "@/modules/workflows/repositories";
import { getTaskList, getTaskDetailView } from "@/modules/workflows/services/tasks";
import { recordGeneratedFiles } from "@/modules/workflows/services/generator";

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  m.findTaskList.mockReset().mockResolvedValue([]);
  m.findTaskDetail.mockReset().mockResolvedValue(null);
  m.createGeneratedFiles.mockReset().mockResolvedValue(undefined);
});

describe("getTaskList", () => {
  it(":view 보유 kind만 repo에 전달하고 ISO로 직렬화", async () => {
    m.findTaskList.mockResolvedValue([{ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: new Date("2026-06-12T00:00:00Z"), status: "PENDING" }]);
    const out = await getTaskList({ permissionKeys: new Set(["workflows.weekly:view"]) }, {});
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["WEEKLY_REPORT"] }));
    expect(out[0]).toEqual({ id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: "2026-06-12T00:00:00.000Z", status: "PENDING" });
  });

  it("view 권한이 하나도 없으면 kinds=[]로 호출되어 빈 목록", async () => {
    await getTaskList({ permissionKeys: new Set() }, {});
    expect(m.findTaskList).toHaveBeenCalledWith(expect.objectContaining({ kinds: [] }));
  });

  it("여러 kind 권한이면 모두 전달", async () => {
    await getTaskList({ permissionKeys: new Set(["workflows.weekly:view", "workflows.billing:view"]) }, { statuses: ["SENT"] });
    const arg = m.findTaskList.mock.calls[0][0];
    expect(arg.kinds.sort()).toEqual(["BILLING", "WEEKLY_REPORT"]);
    expect(arg.statuses).toEqual(["SENT"]);
  });
});

describe("getTaskDetailView", () => {
  const detail = {
    id: "t1", kind: "WEEKLY_REPORT", typeName: "주간보고", scheduledAt: new Date("2026-06-12T00:00:00Z"), status: "GENERATED",
    createdById: "u1", outputPath: null,
    files: [{ id: "f1", path: "/o/a.xlsx", displayName: "a.xlsx", mimeType: null, sizeBytes: 123n, createdAt: new Date("2026-06-12T00:00:00Z") }],
    mailDeliveries: [{ id: "m1", step: "send", recipients: ["a@x"], subject: "s", status: "FAILED", errorMessage: "boom", providerMessageId: null, sentAt: null }],
    events: [{ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: new Date("2026-06-12T00:00:00Z") }],
  };

  it("없으면 null", async () => {
    m.findTaskDetail.mockResolvedValue(null);
    expect(await getTaskDetailView("nope", { permissionKeys: new Set(["workflows.weekly:view"]) })).toBeNull();
  });

  it("해당 kind :view 없으면 ForbiddenError", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    await expect(getTaskDetailView("t1", { permissionKeys: new Set(["workflows.billing:view"]) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("권한 있으면 DTO(ISO·Number·timeline) 직렬화", async () => {
    m.findTaskDetail.mockResolvedValue(detail);
    const out = await getTaskDetailView("t1", { permissionKeys: new Set(["workflows.weekly:view"]) });
    expect(out!.scheduledAt).toBe("2026-06-12T00:00:00.000Z");
    expect(out!.files[0]).toEqual({ id: "f1", displayName: "a.xlsx", mimeType: null, sizeBytes: 123, createdAt: "2026-06-12T00:00:00.000Z" });
    expect(out!.mailDeliveries[0]).toEqual({ id: "m1", step: "send", recipients: ["a@x"], subject: "s", status: "FAILED", errorMessage: "boom", sentAt: null });
    expect(out!.timeline[0]).toEqual({ id: "e1", fromStatus: null, toStatus: "PENDING", actorId: "u1", note: null, occurredAt: "2026-06-12T00:00:00.000Z" });
  });
});

describe("recordGeneratedFiles", () => {
  it("result.files를 createGeneratedFiles로 위임", async () => {
    await recordGeneratedFiles("t1", { files: [{ path: "/o/a.xlsx", displayName: "a.xlsx" }] });
    expect(m.createGeneratedFiles).toHaveBeenCalledWith("t1", [{ path: "/o/a.xlsx", displayName: "a.xlsx" }]);
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/modules/workflows/tasks-service.test.ts
```

## Step 3 — tasks.ts 구현

생성: `src/modules/workflows/services/tasks.ts`

```ts
import "server-only";
import type { WorkflowKind, WorkflowStatus, MailDeliveryStatus } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { KIND_RESOURCE } from "../policy";
import { findTaskList, findTaskDetail } from "../repositories";

export interface TaskListItem { id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus; }
export interface TimelineEntry { id: string; fromStatus: WorkflowStatus | null; toStatus: WorkflowStatus; actorId: string | null; note: string | null; occurredAt: string; }
export interface MailView { id: string; step: string | null; recipients: string[]; subject: string; status: MailDeliveryStatus; errorMessage: string | null; sentAt: string | null; }
export interface FileView { id: string; displayName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; }
export interface TaskDetailView {
  id: string; kind: WorkflowKind; typeName: string; scheduledAt: string; status: WorkflowStatus;
  files: FileView[]; mailDeliveries: MailView[]; timeline: TimelineEntry[];
}

const ALL_KINDS: WorkflowKind[] = ["WEEKLY_REPORT", "BILLING", "NOTIFICATION_BILLING"];

function allowedKinds(keys: Set<string>): WorkflowKind[] {
  return ALL_KINDS.filter((k) => keys.has(`${KIND_RESOURCE[k]}:view`));
}

export async function getTaskList(
  ctx: { permissionKeys: Set<string> },
  filter: { statuses?: WorkflowStatus[]; start?: Date; end?: Date },
): Promise<TaskListItem[]> {
  const kinds = allowedKinds(ctx.permissionKeys);
  const rows = await findTaskList({ kinds, statuses: filter.statuses, start: filter.start, end: filter.end });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    typeName: r.typeName,
    scheduledAt: r.scheduledAt.toISOString(),
    status: r.status,
  }));
}

// 없으면 null(라우트가 404), 권한 없으면 ForbiddenError(403). kind를 알아야 권한을 판정하므로 먼저 로드한다.
export async function getTaskDetailView(
  id: string,
  ctx: { permissionKeys: Set<string> },
): Promise<TaskDetailView | null> {
  const t = await findTaskDetail(id);
  if (!t) return null;
  if (!ctx.permissionKeys.has(`${KIND_RESOURCE[t.kind]}:view`)) throw new ForbiddenError("열람 권한이 없습니다.");
  return {
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
}
```

## Step 4 — generator.ts 구현

생성: `src/modules/workflows/services/generator.ts`

```ts
import "server-only";
import type { GeneratorResult } from "../types";
import { createGeneratedFiles } from "../repositories";

// GeneratorResult.files를 GeneratedFile로 기록한다(spec §11). 실제 generate 구현·등록은 후속 sub-project.
export async function recordGeneratedFiles(taskId: string, result: GeneratorResult): Promise<void> {
  await createGeneratedFiles(taskId, result.files);
}
```

## Step 5 — PASS

```bash
npm test -- tests/modules/workflows/tasks-service.test.ts
```

## Step 6 — commit

```bash
git add src/modules/workflows/services/tasks.ts src/modules/workflows/services/generator.ts tests/modules/workflows/tasks-service.test.ts
git commit -m "feat(workflows): tasks read service (kind-scoped list/detail DTO) + generator helper"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과
npm test -- tests/modules/workflows/tasks-service.test.ts   # PASS
```

## Cautions

- **목록을 받은 뒤 클라이언트에서 kind를 거르지 말 것.** 서버 `getTaskList`가 보유 kind만 repo에 넘겨 애초에 권한 없는 항목을 조회하지 않는다(fail-closed, spec §9).
- **상세 권한 판정 전에 task를 먼저 로드**해야 kind를 안다 — 이 순서를 바꾸지 말 것. 없으면 null(404), kind 권한 없으면 403.
- BigInt `sizeBytes`는 JSON 직렬화 불가 → `Number()`로 변환(파일 크기는 25MB 한도라 안전). 날짜는 ISO 문자열로.
- 실제 문서 `generate` 로직을 generator.ts에 넣지 말 것 — 계약(`GeneratorPort`)만 공통 기반, 구현은 후속 sub-project(spec §11).
