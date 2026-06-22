# task-08 — 동시성 코어: cascade 삭제(F-6) · reparent(F-7)

**목적:** 스펙 §13이 impl로 이전한 **DEFERRED high F-6·F-7**을 구현하고 전용 동시성 회귀테스트로 닫는다(ledger 종결 조건). cascade 삭제는 captured `(childId, parentId, updatedAt)` CAS로 reparent-away 자식 오삭제를 막고, reparent는 advisory lock + 트리 불변식 재검증으로 동시 reparent의 depth-3·순환을 막는다.

> **이 태스크는 본 계획의 적대검증 핵심이다.** 아래 AC의 동시성 회귀테스트를 빠짐없이 통과해야 ledger F-6·F-7이 닫힌다(스펙 §13 "impl plan AC + 동시성 회귀테스트").

## Files

- **Modify:** `src/modules/admin/navigation/repositories/index.ts` — `import type { Prisma }` → `import { Prisma }`(런타임 사용); `isForeignKeyViolation`·`cascadeDelete`(F-6)·`reparentItem`(F-7) 추가.
- **Create (test):** `tests/modules/admin/navigation/concurrency.test.ts`

## Prep

- 스펙 §13(F-6·F-7 인수기준)·§10(엣지)·결정 D6/D11/D12.
- 엔트리포인트 §Shared Contracts **SC-8**(동시성 계약 — F-6·F-7 메커니즘)·**SC-9**(에러).
- task-07: 같은 파일의 `lockNavTree`·`assertParentTopLevel`(모듈-private, in-scope 재사용), `NavigationConflictError`/`NavigationValidationError`.
- 패턴 출처: leave `approveTx`(CAS `updateMany`+`count===0`), `lockUserAndAssertNoOverlap`(락 후 재확인).

## Deps

task-07(repo 헬퍼·CRUD).

## Cautions

- **F-6 핵심: captured ID만 `parentId`+`updatedAt` CAS로 삭제하고 영향 row 합계가 캡처 수와 일치해야 한다.** `deleteMany({where:{parentId}})`로 즉석 일괄삭제 금지(확인 안 된/옮겨간 자식 무단삭제). 불일치면 **전체 롤백**.
- **F-6 잔존 레이스: count 체크 이후 늦게 추가/이동된 자식**은 `parentId` FK RESTRICT(task-01)가 부모 삭제를 DB에서 거부(P2003) → 잡아서 `NavigationConflictError`로 변환·롤백. FK 위반을 삼켜 부분 삭제하지 말 것.
- **F-7 핵심: reparent는 lock 후 ① 대상 부모 top-level ② 이동 노드 무자식 ③ 자기참조 아님을 재검증.** 단일행 CAS만으론 동시 reparent의 depth-3을 못 막는다 — lock 직렬화 + 재검증이 본질.
- 동시성의 실제 DB 강제(advisory lock·FK RESTRICT)는 dev 배포에서 작동한다. 본 테스트는 **재검증 분기·CAS 영향행수·FK 위반 매핑을 결정론적으로 고정**(모킹 prisma로 `count`/throw 제어 — leave repositories.test 패턴). 정직하게: 이 테스트는 로직 가드이며, 진짜 동시성은 dev에서 검증.

## Step 1 — 실패 테스트: cascade(F-6) · reparent(F-7)

`tests/modules/admin/navigation/concurrency.test.ts` 생성:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => {
  const db = {
    navigationItem: {
      findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(),
      deleteMany: vi.fn(), updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  const prisma = { ...db, $transaction: vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db)) };
  return { db, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
const writeAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/kernel/audit", () => ({ writeAudit: (...a: unknown[]) => writeAuditMock(...a) }));

import { cascadeDelete, reparentItem } from "@/modules/admin/navigation/repositories";
import { NavigationConflictError, NavigationValidationError } from "@/modules/admin/navigation/errors";

beforeEach(() => { vi.clearAllMocks(); });

const cAt = new Date("2026-06-22T00:00:00Z");
const pAt = new Date("2026-06-21T00:00:00Z");

describe("cascadeDelete (F-6)", () => {
  it("정상: captured 자식 전부 CAS 삭제 후 부모 삭제(트리락 사용) + audit in-tx", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 }) // child c1
      .mockResolvedValueOnce({ count: 1 }) // child c2
      .mockResolvedValueOnce({ count: 1 }); // parent
    await cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }, { id: "c2", updatedAt: cAt }],
    }, "admin1");
    expect(h.db.$queryRaw).toHaveBeenCalled(); // lockNavTree
    // 각 자식 CAS where: id+parentId+updatedAt
    expect(h.db.navigationItem.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: "c1", parentId: "p1", updatedAt: cAt } });
    expect(h.db.navigationItem.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: "c2", parentId: "p1", updatedAt: cAt } });
    // 부모 CAS where: id+updatedAt
    expect(h.db.navigationItem.deleteMany).toHaveBeenNthCalledWith(3, { where: { id: "p1", updatedAt: pAt } });
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "delete", entityId: "p1" }));
  });

  it("reparent-away 자식(CAS count 0): 영향행수 불일치 → 롤백, 부모 삭제·audit 미호출", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 }) // c1 정상
      .mockResolvedValueOnce({ count: 0 }); // c2가 다른 부모로 옮겨감 → CAS 불일치
    await expect(cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }, { id: "c2", updatedAt: cAt }],
    }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(h.db.navigationItem.deleteMany).toHaveBeenCalledTimes(2); // 부모 삭제까지 가지 않음
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("count 체크 이후 늦게 추가된 자식(부모 삭제 FK 위반 P2003) → Conflict로 변환·롤백", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 }) // captured child
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("FK", { code: "P2003", clientVersion: "x" })); // parent delete
    await expect(cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }],
    }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("부모 CAS 충돌(count 0): Conflict", async () => {
    h.db.navigationItem.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // 부모 updatedAt mismatch
    await expect(cascadeDelete({
      parentId: "p1", parentUpdatedAt: pAt,
      children: [{ id: "c1", updatedAt: cAt }],
    }, "admin1")).rejects.toBeInstanceOf(NavigationConflictError);
  });

  it("자식 없는 노드(leaf): 부모만 CAS 삭제 + audit", async () => {
    h.db.navigationItem.deleteMany.mockResolvedValueOnce({ count: 1 });
    await cascadeDelete({ parentId: "p1", parentUpdatedAt: pAt, children: [] }, "admin1");
    expect(h.db.navigationItem.deleteMany).toHaveBeenCalledTimes(1);
    expect(h.db.navigationItem.deleteMany).toHaveBeenCalledWith({ where: { id: "p1", updatedAt: pAt } });
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "delete" }));
  });
});

describe("reparentItem (F-7)", () => {
  const expectedAt = new Date("2026-06-22T00:00:00Z");

  it("정상 승격(newParentId null): 락 + CAS 이동 + audit", async () => {
    h.db.navigationItem.findUnique.mockResolvedValue({ updatedAt: expectedAt, parentId: "old" });
    h.db.navigationItem.findFirst.mockResolvedValue({ sortOrder: 20 });
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 1 });
    await reparentItem({ id: "a", newParentId: null, expectedUpdatedAt: expectedAt }, "admin1");
    expect(h.db.$queryRaw).toHaveBeenCalled();
    expect(h.db.navigationItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "a", updatedAt: expectedAt }, data: { parentId: null, sortOrder: 30 },
    }));
    expect(writeAuditMock).toHaveBeenCalledWith(h.db, expect.objectContaining({ action: "reparent", entityId: "a" }));
  });

  it("정상 이동(top-level 부모, 무자식): CAS 이동", async () => {
    h.db.navigationItem.findUnique
      .mockResolvedValueOnce({ updatedAt: expectedAt, parentId: null }) // 이동 노드
      .mockResolvedValueOnce({ parentId: null });                        // 대상 부모 top-level
    h.db.navigationItem.count.mockResolvedValue(0);                      // 이동 노드 무자식
    h.db.navigationItem.findFirst.mockResolvedValue(null);
    h.db.navigationItem.updateMany.mockResolvedValue({ count: 1 });
    await reparentItem({ id: "a", newParentId: "b", expectedUpdatedAt: expectedAt }, "admin1");
    expect(h.db.navigationItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { parentId: "b", sortOrder: 10 },
    }));
  });

  it("F-7: 대상 부모가 이미 자식이면(depth 위반) ValidationError(audit 미기록)", async () => {
    h.db.navigationItem.findUnique
      .mockResolvedValueOnce({ updatedAt: expectedAt, parentId: null }) // 이동 노드
      .mockResolvedValueOnce({ parentId: "g1" });                        // 대상 부모가 중메뉴
    await expect(reparentItem({ id: "a", newParentId: "b", expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationValidationError);
    expect(h.db.navigationItem.updateMany).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("F-7: 이동 노드가 자식을 가지면(중메뉴화=depth3) ValidationError", async () => {
    h.db.navigationItem.findUnique
      .mockResolvedValueOnce({ updatedAt: expectedAt, parentId: null }) // 이동 노드
      .mockResolvedValueOnce({ parentId: null });                        // 대상 부모 top-level
    h.db.navigationItem.count.mockResolvedValue(2);                      // 이동 노드가 자식 보유
    await expect(reparentItem({ id: "a", newParentId: "b", expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationValidationError);
    expect(h.db.navigationItem.updateMany).not.toHaveBeenCalled();
  });

  it("자기 자신을 부모로: ValidationError(순환 차단)", async () => {
    await expect(reparentItem({ id: "a", newParentId: "a", expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationValidationError);
  });

  it("stale updatedAt: Conflict", async () => {
    h.db.navigationItem.findUnique.mockResolvedValue({ updatedAt: new Date("2026-06-20T00:00:00Z"), parentId: null });
    await expect(reparentItem({ id: "a", newParentId: null, expectedUpdatedAt: expectedAt }, "admin1"))
      .rejects.toBeInstanceOf(NavigationConflictError);
  });
});
```

실행: `npm test -- navigation/concurrency` → **FAIL**.

## Step 2 — repositories/index.ts에 추가

1. 상단 import 변경(런타임 `Prisma` 필요 — `PrismaClientKnownRequestError`):

```ts
import { Prisma } from "@prisma/client";
```

(task-07의 `import type { Prisma } from "@prisma/client";`를 위 값 import로 교체. `Prisma.TransactionClient` 타입 용도는 그대로 동작.) `writeAudit`는 task-07이 이미 같은 파일에 import해 둠 — `cascadeDelete`/`reparentItem`이 in-tx로 재사용(P1).

2. 파일 말미에 추가:

```ts
// Prisma FK 제약 위반(P2003) 식별 — cascade 부모 삭제가 늦은 자식 때문에 거부될 때(F-4).
function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}

// cascade 삭제(D11/F-6). 확인 시점 captured 자식을 (id, parentId, updatedAt) CAS로만 삭제하고
// 영향 row 합계가 캡처 수와 일치해야 한다(reparent-away/수정된 자식 오삭제 방지 → 불일치면 롤백).
// 이후 부모 CAS 삭제. count 체크 후 늦게 추가/이동된 자식이 있으면 parentId FK RESTRICT가
// 부모 삭제를 거부(P2003) → Conflict로 변환·롤백(F-4). leaf는 children=[]로 부모만 삭제.
export async function cascadeDelete(input: {
  parentId: string;
  parentUpdatedAt: Date;
  children: Array<{ id: string; updatedAt: Date }>;
}, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockNavTree(tx);
    let affected = 0;
    for (const child of input.children) {
      const res = await tx.navigationItem.deleteMany({
        where: { id: child.id, parentId: input.parentId, updatedAt: child.updatedAt },
      });
      affected += res.count;
    }
    if (affected !== input.children.length) {
      throw new NavigationConflictError("하위 메뉴 구성이 변경되었습니다. 새로고침 후 다시 시도하세요.");
    }
    try {
      const parentRes = await tx.navigationItem.deleteMany({
        where: { id: input.parentId, updatedAt: input.parentUpdatedAt },
      });
      if (parentRes.count === 0) throw new NavigationConflictError();
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new NavigationConflictError("다른 사용자가 하위 메뉴를 추가했습니다. 새로고침 후 다시 시도하세요.");
      }
      throw e;
    }
    // audit in-tx(P1) — 삭제 성공 후 같은 트랜잭션에서 기록(실패 시 삭제 롤백).
    await writeAudit(tx, {
      actorId, entityType: "NavigationItem", entityId: input.parentId, action: "delete",
      metadata: { childCount: input.children.length },
    });
  });
}

// reparent(D6/D12/F-7). advisory lock 직렬화 후 트리 불변식 재검증:
// ① 대상 부모 top-level ② 이동 노드 무자식(중메뉴화=depth3 차단) ③ 자기참조 아님. CAS로 이동.
export async function reparentItem(input: {
  id: string;
  newParentId: string | null;
  expectedUpdatedAt: Date;
}, actorId: string): Promise<void> {
  if (input.newParentId === input.id) {
    throw new NavigationValidationError("자기 자신을 부모로 지정할 수 없습니다.");
  }
  await prisma.$transaction(async (tx) => {
    await lockNavTree(tx);
    const node = await tx.navigationItem.findUnique({
      where: { id: input.id },
      select: { updatedAt: true, parentId: true },
    });
    if (!node) throw new NavigationConflictError("메뉴를 찾을 수 없습니다.");
    if (node.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new NavigationConflictError();

    if (input.newParentId !== null) {
      await assertParentTopLevel(tx, input.newParentId);     // ② depth-2(F-7)
      const childCount = await tx.navigationItem.count({ where: { parentId: input.id } });
      if (childCount > 0) {
        throw new NavigationValidationError("하위 메뉴가 있는 메뉴는 중메뉴로 옮길 수 없습니다(2단까지).");
      }
    }

    const last = await tx.navigationItem.findFirst({
      where: { parentId: input.newParentId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const updated = await tx.navigationItem.updateMany({
      where: { id: input.id, updatedAt: input.expectedUpdatedAt },
      data: { parentId: input.newParentId, sortOrder: (last?.sortOrder ?? 0) + 10 },
    });
    if (updated.count === 0) throw new NavigationConflictError();
    // audit in-tx(P1).
    await writeAudit(tx, {
      actorId, entityType: "NavigationItem", entityId: input.id, action: "reparent",
      metadata: { newParentId: input.newParentId },
    });
  });
}
```

실행: `npm test -- navigation/concurrency` → **PASS**.

## Acceptance Criteria (F-6·F-7 ledger 종결 조건)

- `npm test -- navigation/concurrency` → **전 케이스 PASS**. 특히:
  - **F-6:** reparent-away 자식(CAS count 0) → 작업 롤백·부모 삭제 미호출. 늦은 자식(P2003) → Conflict 변환. captured만 삭제(`(id,parentId,updatedAt)` CAS).
  - **F-7:** 대상 부모가 자식이면 거부 / 이동 노드가 자식 보유 시 거부 / 자기참조 거부 / stale Conflict.
- `npm test -- navigation` → repo·concurrency·validations 전부 PASS(회귀 없음).
- `npm run typecheck` → 0 errors(`Prisma` 값 import 적용).
- `npm run lint` → 0 errors.
- 스펙 §13 update: 본 AC 통과 시 ledger F-6·F-7 disposition을 **FIXED**로 갱신(impl 완료) — review-loop에서 반영.
