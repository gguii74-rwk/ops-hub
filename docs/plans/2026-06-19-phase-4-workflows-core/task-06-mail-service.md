# Task 06 — mail repository + service (deliver/retry/resolve)

발송 멱등(`(taskId,step)`)·SENDING 선기록·1회 갱신·재시도·운영자 해소를 구현한다. 이 계층이 중복 SMTP를 foundation에서 막는다(spec §13 "발송 중복방지는 공통 기반의 책임").

## Files

- Create: `src/modules/workflows/repositories/mail.ts`
- Create: `src/modules/workflows/services/mail.ts`
- Create (test): `tests/modules/workflows/mail-repository.test.ts`
- Create (test): `tests/modules/workflows/mail-service.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-2**(`MailActionCtx`,`ConflictError`), **SC-5**(mail repo), **SC-6**(mail service), **SC-7**(lib `sendMail`/`MailMessage`).
- Spec §6.2(deliver·retry 절차), §6.3(send orchestration·SENDING 해소·resolve), §4.2(부분 unique 인덱스).

## Deps

- Task 01(스키마), Task 02(types/policy), Task 05(`sendMail`).

## Step 1 — 실패 테스트 (repository)

생성: `tests/modules/workflows/mail-repository.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const calls: Record<string, any> = {};
  const ret: any = { active: null, created: { id: "d1" }, found: null, throwP2002: false };
  return { calls, ret };
});

vi.mock("@/lib/prisma", () => {
  const client: any = {
    mailDelivery: {
      findFirst: async (a: any) => ((h.calls.findFirst = a), h.ret.active),
      create: async (a: any) => {
        h.calls.create = a;
        if (h.ret.throwP2002) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        return { id: "d1", ...a.data };
      },
      update: async (a: any) => ((h.calls.update = a), { id: a.where.id, ...a.data }),
      findUnique: async (a: any) => ((h.calls.findUnique = a), h.ret.found),
    },
    $transaction: async (fn: any) => fn(client),
  };
  return { prisma: client };
});

import { createSendingDelivery, finalizeDelivery, findDeliveryForAction } from "@/modules/workflows/repositories/mail";
import { ConflictError } from "@/modules/workflows/types";

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.ret.active = null;
  h.ret.found = null;
  h.ret.throwP2002 = false;
});

describe("createSendingDelivery", () => {
  it("활성 발송 없으면 SENDING·sentAt=null로 생성", async () => {
    const out = await createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "<p>h</p>", attachmentPaths: [], sentById: "u1" });
    expect(out.id).toBe("d1");
    expect(h.calls.create.data).toMatchObject({ taskId: "t1", step: "send", status: "SENDING", sentAt: null, bodyHtml: "<p>h</p>" });
  });

  it("(taskId,step) 활성 레코드가 있으면 ConflictError(생성 안 함)", async () => {
    h.ret.active = { id: "existing" };
    await expect(createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("taskId 또는 step이 null이면 멱등 가드를 적용하지 않는다", async () => {
    h.ret.active = { id: "existing" }; // 있더라도 무시돼야 함
    await createSendingDelivery({ taskId: null, step: null, recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" });
    expect(h.calls.findFirst).toBeUndefined();
    expect(h.calls.create).toBeDefined();
  });

  it("부분 unique 인덱스 경합(P2002) → ConflictError로 정규화", async () => {
    h.ret.throwP2002 = true;
    await expect(createSendingDelivery({ taskId: "t1", step: "send", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("finalizeDelivery", () => {
  it("SENT 갱신은 sentAt·providerMessageId를 설정", async () => {
    await finalizeDelivery("d1", { status: "SENT", sentAt: new Date("2026-06-12"), providerMessageId: "pm1" });
    expect(h.calls.update.where).toEqual({ id: "d1" });
    expect(h.calls.update.data).toMatchObject({ status: "SENT", providerMessageId: "pm1" });
  });

  it("providerMessageId 미지정 시 해당 컬럼을 건드리지 않는다(resolve용)", async () => {
    await finalizeDelivery("d1", { status: "FAILED", sentAt: null, errorMessage: "x" });
    expect("providerMessageId" in h.calls.update.data).toBe(false);
    expect(h.calls.update.data).toMatchObject({ status: "FAILED", errorMessage: "x" });
  });
});

describe("findDeliveryForAction", () => {
  it("task→type.kind를 평탄화하고 recipients/attachmentPaths를 배열로", async () => {
    h.ret.found = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], subject: "s", bodyHtml: "<p>h</p>", attachmentPaths: ["/o/a.pdf"], task: { type: { kind: "BILLING" } } };
    const out = await findDeliveryForAction("d1");
    expect(out).toMatchObject({ id: "d1", taskId: "t1", status: "FAILED", kind: "BILLING", recipients: ["a@x"], attachmentPaths: ["/o/a.pdf"] });
  });
  it("없으면 null", async () => {
    expect(await findDeliveryForAction("nope")).toBeNull();
  });
});
```

## Step 2 — FAIL → repository 구현

생성: `src/modules/workflows/repositories/mail.ts`

```ts
import "server-only";
import { Prisma } from "@prisma/client";
import type { MailDelivery, MailDeliveryStatus, WorkflowKind } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { ConflictError } from "../types";

export interface DeliveryForAction {
  id: string; taskId: string | null; step: string | null; status: MailDeliveryStatus;
  recipients: string[]; subject: string; bodyHtml: string | null; attachmentPaths: string[];
  kind: WorkflowKind | null;
}

// (taskId,step) 멱등 가드(tx 내 활성 조회 + create). 경합 시 부분 unique 인덱스 P2002 → ConflictError.
export async function createSendingDelivery(args: {
  taskId: string | null; step: string | null; recipients: string[]; subject: string;
  bodyHtml: string; attachmentPaths: string[]; sentById: string;
}): Promise<MailDelivery> {
  try {
    return await prisma.$transaction(async (tx: PrismaTx) => {
      if (args.taskId != null && args.step != null) {
        const active = await tx.mailDelivery.findFirst({
          where: { taskId: args.taskId, step: args.step, status: { in: ["SENDING", "SENT"] } },
          select: { id: true },
        });
        if (active) throw new ConflictError("이미 진행 중이거나 완료된 발송이 있습니다.");
      }
      return tx.mailDelivery.create({
        data: {
          taskId: args.taskId,
          step: args.step,
          status: "SENDING",
          recipients: args.recipients,
          subject: args.subject,
          bodyHtml: args.bodyHtml,
          attachmentPaths: args.attachmentPaths,
          sentById: args.sentById,
          sentAt: null,
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("이미 진행 중인 발송이 있습니다.");
    }
    throw e;
  }
}

// 같은 레코드를 정확히 1회 SENT/FAILED로 갱신. providerMessageId는 지정 시에만 갱신(resolve가 기존 값을 지우지 않게).
export async function finalizeDelivery(
  id: string,
  patch: { status: "SENT" | "FAILED"; sentAt: Date | null; providerMessageId?: string | null; errorMessage?: string | null },
): Promise<MailDelivery> {
  const data: Prisma.MailDeliveryUpdateInput = {
    status: patch.status,
    sentAt: patch.sentAt,
    errorMessage: patch.errorMessage ?? null,
  };
  if (patch.providerMessageId !== undefined) data.providerMessageId = patch.providerMessageId;
  return prisma.mailDelivery.update({ where: { id }, data });
}

export async function findDeliveryForAction(deliveryId: string): Promise<DeliveryForAction | null> {
  const d = await prisma.mailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true, taskId: true, step: true, status: true, recipients: true, subject: true,
      bodyHtml: true, attachmentPaths: true,
      task: { select: { type: { select: { kind: true } } } },
    },
  });
  if (!d) return null;
  return {
    id: d.id,
    taskId: d.taskId,
    step: d.step,
    status: d.status,
    recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : [],
    subject: d.subject,
    bodyHtml: d.bodyHtml,
    attachmentPaths: Array.isArray(d.attachmentPaths) ? (d.attachmentPaths as string[]) : [],
    kind: d.task?.type.kind ?? null,
  };
}
```

```bash
npm test -- tests/modules/workflows/mail-repository.test.ts   # PASS
```

## Step 3 — 실패 테스트 (service)

생성: `tests/modules/workflows/mail-service.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/kernel/access", () => ({ ForbiddenError: class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } } }));
vi.mock("@/lib/integrations/mail", () => ({ sendMail: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("@/modules/workflows/repositories/mail", () => ({
  createSendingDelivery: vi.fn(),
  finalizeDelivery: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
  findDeliveryForAction: vi.fn(),
}));

import { ForbiddenError } from "@/kernel/access";
import { ConflictError } from "@/modules/workflows/types";
import { sendMail } from "@/lib/integrations/mail";
import { existsSync } from "node:fs";
import * as mailRepo from "@/modules/workflows/repositories/mail";
import { deliver, retryDelivery, resolveDelivery } from "@/modules/workflows/services/mail";

const repo = mailRepo as unknown as Record<string, ReturnType<typeof vi.fn>>;
const send = sendMail as unknown as ReturnType<typeof vi.fn>;
const fsExists = existsSync as unknown as ReturnType<typeof vi.fn>;
const ctx = (over: Partial<{ isOwner: boolean; isAdmin: boolean; keys: string[] }> = {}) => ({
  userId: "u1", isOwner: over.isOwner ?? false, isAdmin: over.isAdmin ?? false, permissionKeys: new Set(over.keys ?? []),
});

beforeEach(() => {
  repo.createSendingDelivery.mockReset().mockResolvedValue({ id: "d1" });
  repo.finalizeDelivery.mockReset().mockImplementation(async (id: string, patch: any) => ({ id, ...patch }));
  repo.findDeliveryForAction.mockReset();
  send.mockReset().mockResolvedValue({ providerMessageId: "pm1" });
  fsExists.mockReset().mockReturnValue(true);
});

describe("deliver", () => {
  it("SENDING 선기록 → SMTP 성공 → SENT 갱신", async () => {
    const out = await deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "<p>h</p>" }, sentById: "u1" });
    expect(repo.createSendingDelivery).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", step: "send", bodyHtml: "<p>h</p>" }));
    expect(send).toHaveBeenCalled();
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT", providerMessageId: "pm1" }));
    expect((out as any).status).toBe("SENT");
  });

  it("SMTP 실패 → FAILED 갱신(에러 비전파, 전이 롤백 없음)", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    const out = await deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "h" }, sentById: "u1" });
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED", sentAt: null, errorMessage: "smtp down" }));
    expect((out as any).status).toBe("FAILED");
  });

  it("멱등 충돌(createSendingDelivery ConflictError) → 전파, SMTP 미발생", async () => {
    repo.createSendingDelivery.mockRejectedValue(new ConflictError());
    await expect(deliver({ taskId: "t1", step: "send", msg: { to: ["a@x"], subject: "s", html: "h" }, sentById: "u1" })).rejects.toBeInstanceOf(ConflictError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("retryDelivery", () => {
  const failed = { id: "d1", taskId: "t1", step: "send", status: "FAILED", recipients: ["a@x"], subject: "s", bodyHtml: "<p>저장본문</p>", attachmentPaths: ["/o/a.pdf"], kind: "WEEKLY_REPORT" };

  it("FAILED를 저장된 bodyHtml로 재발송(워크플로 재생성 없음) → SENT", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x"], subject: "s", html: "<p>저장본문</p>" }));
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
  });

  it("없음 → Forbidden", async () => {
    repo.findDeliveryForAction.mockResolvedValue(null);
    await expect(retryDelivery({ deliveryId: "x", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("taskId 불일치 → Forbidden", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, taskId: "other" });
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("SENDING(발송 불확실)은 재시도 불가 → Conflict", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...failed, status: "SENDING" });
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("타 kind :send로는 거부 → Forbidden", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed); // kind=WEEKLY_REPORT
    await expect(retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.billing:send"] }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("첨부 유실 → SMTP 없이 FAILED 확정", async () => {
    repo.findDeliveryForAction.mockResolvedValue(failed);
    fsExists.mockReturnValue(false);
    await retryDelivery({ deliveryId: "d1", taskId: "t1" }, ctx({ keys: ["workflows.weekly:send"] }));
    expect(send).not.toHaveBeenCalled();
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });
});

describe("resolveDelivery", () => {
  const sending = { id: "d1", taskId: "t1", step: "send", status: "SENDING", recipients: ["a@x"], subject: "s", bodyHtml: "h", attachmentPaths: [], kind: "WEEKLY_REPORT" };

  it("비-admin → Forbidden", async () => {
    await expect(resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: false }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admin이 SENDING→FAILED 확정", async () => {
    repo.findDeliveryForAction.mockResolvedValue(sending);
    await resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: true }));
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "FAILED" }));
  });

  it("admin이 SENDING→SENT 확정", async () => {
    repo.findDeliveryForAction.mockResolvedValue(sending);
    await resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "SENT" }, ctx({ isAdmin: true }));
    expect(repo.finalizeDelivery).toHaveBeenCalledWith("d1", expect.objectContaining({ status: "SENT" }));
  });

  it("SENDING이 아니면 Conflict", async () => {
    repo.findDeliveryForAction.mockResolvedValue({ ...sending, status: "SENT" });
    await expect(resolveDelivery({ deliveryId: "d1", taskId: "t1", to: "FAILED" }, ctx({ isAdmin: true }))).rejects.toBeInstanceOf(ConflictError);
  });
});
```

## Step 4 — service 구현

생성: `src/modules/workflows/services/mail.ts`

```ts
import "server-only";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { MailDelivery, WorkflowKind } from "@prisma/client";
import { ForbiddenError } from "@/kernel/access";
import { sendMail, type MailMessage } from "@/lib/integrations/mail";
import { ConflictError, type MailActionCtx } from "../types";
import { KIND_RESOURCE } from "../policy";
import { createSendingDelivery, finalizeDelivery, findDeliveryForAction } from "../repositories/mail";

function canSend(ctx: MailActionCtx, kind: WorkflowKind): boolean {
  return ctx.isOwner || ctx.permissionKeys.has(`${KIND_RESOURCE[kind]}:send`);
}

// 발송 전 SENDING 레코드 생성 → SMTP → 정확히 1회 SENT/FAILED 갱신(§6.2).
// 워크플로 상태 전이와 분리 — 발송 실패가 직전 전이를 롤백하지 않는다.
export async function deliver(args: {
  taskId: string | null; step: string | null; msg: MailMessage; sentById: string;
}): Promise<MailDelivery> {
  // 멱등 가드 + SENDING 선기록. 활성 중복이면 ConflictError(SMTP 미발생).
  const record = await createSendingDelivery({
    taskId: args.taskId,
    step: args.step,
    recipients: args.msg.to,
    subject: args.msg.subject,
    bodyHtml: args.msg.html,
    attachmentPaths: (args.msg.attachments ?? []).map((a) => a.path),
    sentById: args.sentById,
  });

  try {
    const { providerMessageId } = await sendMail(args.msg);
    return await finalizeDelivery(record.id, { status: "SENT", sentAt: new Date(), providerMessageId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finalizeDelivery(record.id, { status: "FAILED", sentAt: null, errorMessage: message });
  }
}

// FAILED 레코드를 저장된 본문으로 그대로 재발송(워크플로 재생성 없음). 새 행 없이 기존 레코드를 갱신.
export async function retryDelivery(
  args: { deliveryId: string; taskId: string },
  ctx: MailActionCtx,
): Promise<MailDelivery> {
  const d = await findDeliveryForAction(args.deliveryId);
  if (!d) throw new ForbiddenError("발송 이력을 찾을 수 없습니다.");
  if (d.taskId !== args.taskId) throw new ForbiddenError("해당 작업의 발송이 아닙니다.");
  if (d.status !== "FAILED") throw new ConflictError("실패한 발송만 재시도할 수 있습니다.");
  if (!d.kind || !canSend(ctx, d.kind)) throw new ForbiddenError("재발송 권한이 없습니다.");

  // 첨부가 shared storage에서 사라졌으면 조용히 실패시키지 않고 FAILED로 확정(§6.2).
  const missing = d.attachmentPaths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: `첨부 파일 없음: ${missing.join(", ")}` });
  }

  try {
    const { providerMessageId } = await sendMail({
      to: d.recipients,
      subject: d.subject,
      html: d.bodyHtml ?? "",
      attachments: d.attachmentPaths.map((p) => ({ filename: basename(p), path: p })),
    });
    return await finalizeDelivery(d.id, { status: "SENT", sentAt: new Date(), providerMessageId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return finalizeDelivery(d.id, { status: "FAILED", sentAt: null, errorMessage: message });
  }
}

// admin 전용. SENDING 잔여를 SENT/FAILED로 수동 확정해 멱등 가드를 해제·종료(§6.3).
export async function resolveDelivery(
  args: { deliveryId: string; taskId: string; to: "SENT" | "FAILED" },
  ctx: MailActionCtx,
): Promise<MailDelivery> {
  if (!ctx.isAdmin) throw new ForbiddenError("관리자만 해소할 수 있습니다.");
  const d = await findDeliveryForAction(args.deliveryId);
  if (!d) throw new ForbiddenError("발송 이력을 찾을 수 없습니다.");
  if (d.taskId !== args.taskId) throw new ForbiddenError("해당 작업의 발송이 아닙니다.");
  if (d.status !== "SENDING") throw new ConflictError("SENDING 상태만 수동 확정할 수 있습니다.");
  return finalizeDelivery(d.id, {
    status: args.to,
    sentAt: args.to === "SENT" ? new Date() : null,
    errorMessage: args.to === "FAILED" ? "운영자가 실패로 확정" : null,
  });
}
```

## Step 5 — PASS

```bash
npm test -- tests/modules/workflows/mail-repository.test.ts tests/modules/workflows/mail-service.test.ts
```

## Step 6 — commit

```bash
git add src/modules/workflows/repositories/mail.ts src/modules/workflows/services/mail.ts tests/modules/workflows/mail-repository.test.ts tests/modules/workflows/mail-service.test.ts
git commit -m "feat(workflows): mail deliver/retry/resolve (idempotent SENDING→SENT/FAILED, authz)"
```

## Acceptance Criteria

```bash
npm run typecheck   # 통과
npm run lint        # 통과(Prisma는 repositories/mail.ts에서만; module→lib/mail 허용)
npm test -- tests/modules/workflows/   # 워크플로 스위트 PASS
```

## Cautions

- **`deliver`의 SMTP 실패를 rethrow하지 말 것.** FAILED로 기록하고 레코드를 반환한다 — 발송 실패가 호출자의 직전 전이를 롤백시키면 안 된다(§6.2 "워크플로 상태 전이와 분리").
- **SENDING 레코드를 자동으로 timeout 전환하지 말 것.** 발송 여부 오판→중복 SMTP를 유발한다. 해소는 admin `resolveDelivery`만(§6.3, §13 비목표).
- **retry는 새 `MailDelivery` 행을 만들지 말 것.** 기존 레코드를 갱신한다(멱등 인덱스와 무충돌). 본문은 반드시 저장된 `bodyHtml`을 쓴다 — 워크플로를 재생성하면 본문 drift가 생긴다(§6.2).
- **`SENDING` 재시도를 허용하지 말 것**(발송 불확실). retry는 `FAILED`만. `SENDING`은 admin `resolve`로만 종료.
- 멱등 가드는 `taskId`·`step`이 **둘 다 non-null**일 때만 적용 — 임시/비워크플로 메일(`taskId` null)은 멱등 대상이 아니다(§6.2).
- `finalizeDelivery`에서 `providerMessageId`를 항상 덮어쓰지 말 것 — 지정 시에만 갱신해 resolve가 기존 값을 지우지 않게 한다.
