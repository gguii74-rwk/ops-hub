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
 *
 * 우발적 운영 사용을 막는 가드: 디스패처 플랜 전까지 프로덕션에서 호출하면 던진다.
 * (멱등·재시도·동시성 보장이 없어 중복 발송/고착을 일으킬 수 있으므로 opt-in 없이는 못 돈다.)
 */
export async function processOutbox(limit = 50): Promise<{ processed: number; failed: number }> {
  if (process.env.NODE_ENV === "production" && process.env.OPS_HUB_ALLOW_OUTBOX_RUNNER !== "1") {
    throw new Error(
      "processOutbox is a non-production skeleton (no atomic claim/retry/idempotency); " +
        "build the dispatcher plan or set OPS_HUB_ALLOW_OUTBOX_RUNNER=1 to override.",
    );
  }

  const pending = await prisma.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      await dispatch({ type: row.type, payload: row.payload as JsonValue });
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
