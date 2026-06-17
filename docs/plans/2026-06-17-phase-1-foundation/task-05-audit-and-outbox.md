# Task 05 — 감사 로그 + outbox 발행/디스패처 (이벤트 버스 골격)

목적: 커널에 ① 감사 로그 기록기(`writeAudit`)와 ② 모듈 간 통신의 토대인 outbox 이벤트 버스(`publishEvent`/`registerHandler`/`processOutbox`)를 만든다. Phase 1엔 실제 핸들러·발행자가 없지만, 테이블(task-02)과 함께 **seam을 깔아** 도메인 모듈이 붙을 때 바로 쓰게 한다.

## Files

- Create: `src/kernel/audit/index.ts`
- Create: `src/kernel/events/index.ts`
- Create: `tests/kernel/events/registry.test.ts`

## Prep

- §Shared Contracts **SC-3**(OutboxEvent), **SC-4**(이벤트 버스 시그니처), **SC-8**(prisma).
- spec §5(3)/§6 — 같은 트랜잭션 발행, 멱등 핸들러, "놓침 없음".

## Deps

03(prisma client).

## Steps

### 1. 감사 로그 기록기 — `src/kernel/audit/index.ts`

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaTx } from "@/lib/prisma";

export interface AuditInput {
  actorId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * 감사 로그 1건 기록. 트랜잭션 안에서 쓰려면 `tx`를, 아니면 전역 `prisma`를 넘긴다.
 * (PrismaClient는 구조적으로 PrismaTx에 대입 가능하므로 둘 다 받는다.)
 */
export async function writeAudit(client: PrismaTx, input: AuditInput): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      metadata: (input.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
}

export { prisma as auditClient };
```

### 2. 이벤트 버스 — `src/kernel/events/index.ts`

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaTx } from "@/lib/prisma";

/** outbox payload는 Json 컬럼 → 직렬화 가능한 값만 허용(클래스 인스턴스·undefined·함수 차단). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

/** 이벤트 타입명 규약: `${module}.${entity}.${action}` 예: "leave.request.approved" */
export interface DomainEvent<P extends JsonValue = JsonValue> {
  type: string;
  payload: P;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

const registry = new Map<string, EventHandler[]>();

export function registerHandler(type: string, handler: EventHandler): void {
  const list = registry.get(type) ?? [];
  list.push(handler);
  registry.set(type, list);
}

export function handlersFor(type: string): EventHandler[] {
  return registry.get(type) ?? [];
}

/** 테스트 격리용. */
export function clearHandlers(): void {
  registry.clear();
}

/** 등록된 핸들러 전부 호출. 핸들러는 멱등이어야 한다(같은 이벤트 두 번 받아도 안전). */
export async function dispatch(event: DomainEvent): Promise<void> {
  for (const handler of handlersFor(event.type)) {
    await handler(event);
  }
}

/**
 * 원본 변경과 "같은 트랜잭션"으로 outbox에 기록한다.
 * 저장과 발행이 분리되지 않으므로 "원본은 바뀌었는데 이벤트는 증발" 상태가 불가능하다.
 */
export async function publishEvent(tx: PrismaTx, event: DomainEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
}

/**
 * PENDING outbox를 읽어 핸들러에 전달하고 상태를 표시하는 **단일 러너 골격**이다.
 * 성공 → DONE, 실패 → FAILED. Phase 1엔 발행자·핸들러·스케줄 워커가 0개라 실제로 거의 실행되지 않는다.
 *
 * ⚠️ 동시 실행 금지. 프로덕션급 디스패처(원자적 claim + lease/복구 + 제한 재시도·백오프 + 멱등키)는
 * 서로 맞물리는 한 덩어리라, 실제 워커가 생기는 **디스패처 플랜에서 통째로** 설계·테스트한다.
 * 골격에 절반만 끼워 넣지 않는다 — 예: PROCESSING 중간 상태만 두면 복구 경로 없이 행이 고착된다.
 */
export async function processOutbox(limit = 50): Promise<{ processed: number; failed: number }> {
  const pending = await prisma.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      await dispatch({ type: row.type, payload: row.payload });
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: "DONE", processedAt: new Date(), attempts: { increment: 1 } },
      });
      processed += 1;
    } catch (error) {
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: "FAILED", attempts: { increment: 1 }, lastError: String(error) },
      });
      failed += 1;
    }
  }
  return { processed, failed };
}
```

### 3. [TDD] 레지스트리/디스패치 테스트 — `tests/kernel/events/registry.test.ts`

DB 없이 검증 가능한 부분(등록·조회·디스패치)을 테스트한다.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearHandlers, dispatch, handlersFor, registerHandler } from "@/kernel/events";

describe("event registry", () => {
  beforeEach(() => clearHandlers());

  it("registers handlers and finds them by type; unknown types return none", () => {
    registerHandler("leave.request.approved", vi.fn());
    expect(handlersFor("leave.request.approved")).toHaveLength(1);
    expect(handlersFor("unknown.type")).toHaveLength(0);
  });

  it("dispatch invokes every handler registered for the type", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    registerHandler("workflows.task.created", a);
    registerHandler("workflows.task.created", b);
    await dispatch({ type: "workflows.task.created", payload: { id: "1" } });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("dispatch with no handlers is a no-op (Phase 1 state)", async () => {
    await expect(dispatch({ type: "nothing.registered.yet", payload: {} })).resolves.toBeUndefined();
  });
});
```

### 4. 검증

```bash
npm test           # registry 테스트 3개 통과 + 기존 테스트 유지
npm run typecheck  # 에러 0
npm run lint       # 에러 0 (kernel → lib 의존만)
```

### 5. 커밋

```bash
git add -A
git commit -m "Add audit logger and outbox event bus skeleton"
```

## Acceptance Criteria

- `tests/kernel/events/registry.test.ts` 3개 통과.
- `publishEvent`가 `tx`(또는 prisma)로 `OutboxEvent` 행을 만든다(타입상 `PrismaTx` 인자).
- `processOutbox`(단일 러너 골격)가 PENDING을 읽어 dispatch 후 성공=DONE/실패=FAILED로 표시하고 `{ processed, failed }`를 반환한다. PROCESSING 중간 상태·동시 claim·재시도·복구는 디스패처 플랜으로 위임(여기 없음).
- `writeAudit`가 `tx`/`prisma` 어느 쪽으로도 호출 가능(typecheck 통과).

## Cautions

- **Don't `publishEvent`를 트랜잭션 밖에서 호출하도록 설계하지 마라. Reason:** 원본 변경과 같은 tx여야 "놓침 없음"이 성립한다. 시그니처가 `tx`를 강제하는 이유다(spec §5-3).
- **Don't 핸들러에 비멱등 부수효과를 가정하지 마라. Reason:** outbox 재처리/중복 전달 시 안전해야 한다. 핸들러는 항상 멱등으로 작성한다.
- **Don't 디스패처 상태머신을 골격에 조각조각 끼워 넣지 마라. Reason:** 원자적 claim·lease/복구·제한 재시도·백오프·멱등키는 서로 맞물리는 분산 컴포넌트다. 절반만 넣으면(예: PROCESSING만 두고 복구 없음) 없던 실패 모드(행 고착)가 생긴다. Phase 1은 단일 러너 골격(동시 실행 금지)만 두고, 완전한 디스패처는 실제 워커가 생기는 플랜에서 통째로 설계·테스트한다.
- **Don't Phase 1에서 실제 핸들러나 발행자를 추가하지 마라. Reason:** 소비자(calendar 투영 등)는 별도 플랜. 지금은 seam만 둔다(YAGNI).
