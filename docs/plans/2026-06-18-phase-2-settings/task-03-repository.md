# Task 03 — repository: read raw + write-with-audit tx + concurrency

**Purpose:** `SystemSetting` 접근을 repository 한 곳에 격리한다. write는 **단일 트랜잭션**에 감사를 동반하고, `expectedUpdatedAt` 토큰(null/Date/undefined)에 따라 **원자적 concurrency**를 강제한다.

## Files

- Create: `src/kernel/settings/repository.ts` — `readRaw`, `writeWithAudit`(entrypoint §SC-3·§SC-6·§5.7 spec).
- Test: `tests/kernel/settings/repository.test.ts` — in-memory prisma mock으로 분기·concurrency·audit 검증.

## Prep

- spec §5.5·§5.7, entrypoint §SC-2(에러)·§SC-6(감사).
- `@/lib/prisma`의 `prisma`·`PrismaTx`(Phase 1 SC-8) 사용.

## Deps

- Task 01(`registry.ts`의 `SettingConcurrencyError`).

## TDD steps

### 1. 실패 테스트 작성 — `tests/kernel/settings/repository.test.ts`

> in-memory fake로 `@/lib/prisma`를 mock. 단일 스레드 결정성으로 분기·count·P2002 매핑을 검증한다(실 DB 원자성은 AC 스모크에서 확인).

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

// --- in-memory fake store ---
type Row = { key: string; value: unknown; updatedAt: Date };
const store = new Map<string, Row>();
const audits: any[] = [];
let clock = 1;
const stamp = () => new Date(2026, 0, 1, 0, 0, 0, clock++);

function makeClient(table: Map<string, Row>, auditSink: any[]) {
  const settings = {
    findUnique: async ({ where: { key } }: any) => (table.has(key) ? { ...table.get(key)! } : null),
    findUniqueOrThrow: async ({ where: { key } }: any) => {
      if (!table.has(key)) throw new Error("not found");
      return { ...table.get(key)! };
    },
    create: async ({ data }: any) => {
      if (table.has(data.key)) {
        throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
      }
      const row = { key: data.key, value: data.value, updatedAt: stamp() };
      table.set(data.key, row);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const row = table.get(where.key);
      if (!row || (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime())) {
        return { count: 0 };
      }
      row.value = data.value;
      row.updatedAt = stamp();
      return { count: 1 };
    },
    upsert: async ({ where: { key }, create, update }: any) => {
      const existing = table.get(key);
      const row = existing
        ? { ...existing, value: update.value, updatedAt: stamp() }
        : { key, value: create.value, updatedAt: stamp() };
      table.set(key, row);
      return { ...row };
    },
  };
  return {
    systemSetting: settings,
    auditLog: { create: async ({ data }: any) => (auditSink.push(data), data) },
  };
}

vi.mock("@/lib/prisma", () => {
  const client: any = makeClient(store, audits);
  client.$transaction = async (fn: any) => fn(client);
  return { prisma: client };
});

import { readRaw, writeWithAudit } from "@/kernel/settings/repository";
import { SettingConcurrencyError } from "@/kernel/settings/registry";

const idRedact = (_b: unknown, a: unknown) => ({ after: a }) as any;

beforeEach(() => {
  store.clear();
  audits.length = 0;
  clock = 1;
});

describe("repository readRaw", () => {
  it("없으면 null, 있으면 value+updatedAt", async () => {
    expect(await readRaw("integrations.smtp.host")).toBeNull();
    await writeWithAudit({ key: "integrations.smtp.host", value: "mail", expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    const row = await readRaw("integrations.smtp.host");
    expect(row?.value).toBe("mail");
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });
});

describe("writeWithAudit concurrency", () => {
  it("expectedUpdatedAt=null: 최초 생성 성공 + audit 1건", async () => {
    const { updatedAt } = await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    expect(updatedAt).toBeInstanceOf(Date);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: "SystemSetting", entityId: "k.a.b", action: "settings.update", actorId: "u1" });
  });

  it("expectedUpdatedAt=null인데 이미 존재: SettingConcurrencyError + audit 미기록", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    audits.length = 0;
    await expect(
      writeWithAudit({ key: "k.a.b", value: 2, expectedUpdatedAt: null, actorId: "u2", redact: idRedact }),
    ).rejects.toBeInstanceOf(SettingConcurrencyError);
    expect(audits).toHaveLength(0);
  });

  it("expectedUpdatedAt=Date 일치: update 성공", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    const cur = await readRaw("k.a.b");
    const { updatedAt } = await writeWithAudit({ key: "k.a.b", value: 2, expectedUpdatedAt: cur!.updatedAt, actorId: "u1", redact: idRedact });
    expect(updatedAt.getTime()).toBeGreaterThan(cur!.updatedAt.getTime());
    expect((await readRaw("k.a.b"))!.value).toBe(2);
  });

  it("expectedUpdatedAt=Date 불일치: SettingConcurrencyError", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, expectedUpdatedAt: null, actorId: "u1", redact: idRedact });
    await expect(
      writeWithAudit({ key: "k.a.b", value: 2, expectedUpdatedAt: new Date(1999, 0, 1), actorId: "u1", redact: idRedact }),
    ).rejects.toBeInstanceOf(SettingConcurrencyError);
  });

  it("expectedUpdatedAt=undefined: last-write-wins upsert", async () => {
    await writeWithAudit({ key: "k.a.b", value: 1, actorId: "u1", redact: idRedact });
    await writeWithAudit({ key: "k.a.b", value: 9, actorId: "u1", redact: idRedact });
    expect((await readRaw("k.a.b"))!.value).toBe(9);
  });

  it("redact 결과가 audit.metadata로 기록", async () => {
    await writeWithAudit({ key: "k.a.b", value: "v2", expectedUpdatedAt: null, actorId: "u1", redact: (b, a) => ({ before: b ?? null, after: a }) as any });
    expect(audits[0].metadata).toEqual({ before: null, after: "v2" });
  });
});
```

### 2. 실행 → FAIL

```bash
npm test -- repository
```

기대: `Cannot find module '@/kernel/settings/repository'`.

### 3. 구현 — `src/kernel/settings/repository.ts`

```ts
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTx } from "@/lib/prisma";
import { SettingConcurrencyError } from "./registry";

export interface SettingRow {
  value: unknown;
  updatedAt: Date;
}

export async function readRaw(key: string): Promise<SettingRow | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? { value: row.value, updatedAt: row.updatedAt } : null;
}

export interface WriteParams {
  key: string;
  value: Prisma.InputJsonValue;
  expectedUpdatedAt?: Date | null;
  actorId: string;
  redact: (before: unknown | undefined, after: unknown) => Prisma.InputJsonValue;
}

export async function writeWithAudit(p: WriteParams): Promise<{ updatedAt: Date }> {
  return prisma.$transaction(async (tx: PrismaTx) => {
    const prior = await tx.systemSetting.findUnique({ where: { key: p.key } });
    const before = prior?.value;

    let updatedAt: Date;
    if (p.expectedUpdatedAt === null) {
      try {
        const created = await tx.systemSetting.create({ data: { key: p.key, value: p.value } });
        updatedAt = created.updatedAt;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new SettingConcurrencyError(p.key);
        }
        throw e;
      }
    } else if (p.expectedUpdatedAt instanceof Date) {
      const res = await tx.systemSetting.updateMany({
        where: { key: p.key, updatedAt: p.expectedUpdatedAt },
        data: { value: p.value },
      });
      if (res.count === 0) throw new SettingConcurrencyError(p.key);
      const row = await tx.systemSetting.findUniqueOrThrow({ where: { key: p.key } });
      updatedAt = row.updatedAt;
    } else {
      const row = await tx.systemSetting.upsert({
        where: { key: p.key },
        create: { key: p.key, value: p.value },
        update: { value: p.value },
      });
      updatedAt = row.updatedAt;
    }

    await tx.auditLog.create({
      data: {
        actorId: p.actorId,
        entityType: "SystemSetting",
        entityId: p.key,
        action: "settings.update",
        metadata: p.redact(before, p.value),
      },
    });

    return { updatedAt };
  });
}
```

### 4. 실행 → PASS

```bash
npm test -- repository
```

기대: 8 테스트 통과.

### 5. typecheck/lint

```bash
npm run typecheck && npm run lint
```

### 6. 커밋

```bash
git add src/kernel/settings/repository.ts tests/kernel/settings/repository.test.ts
git commit -m "Add settings repository: transactional write-with-audit and concurrency"
```

## Acceptance Criteria

- `npm test -- repository` → 8 PASS.
- `npm run typecheck` / `npm run lint` → 에러 0.
- (DB 스모크, 로컬 Postgres) `writeWithAudit`로 키 1개 생성→`SystemSetting`·`AuditLog` 각 1행, 동일 키 `expectedUpdatedAt:null` 재호출 시 거부됨을 `prisma studio`/쿼리로 확인.

## Cautions

- **P2002 catch 후 같은 tx에서 다른 쿼리를 실행하지 말 것(즉시 throw). 이유:** Postgres는 에러 발생 시 트랜잭션을 abort하므로 이후 쿼리가 "current transaction is aborted"로 실패한다.
- **Date 경로는 반드시 `updateMany({where:{key, updatedAt}})`의 count로 판정. 이유:** `update`+사전 read는 두 writer가 같은 버전을 읽고 모두 갱신하는 race를 막지 못한다.
- **audit는 같은 `$transaction` 안에서 create. 이유:** §SC-6 — 감사 없는 설정 변경 불가(부분 성공 금지).
- **`value` 타입은 `Prisma.InputJsonValue`. 이유:** `undefined`/함수/클래스 인스턴스가 Json 컬럼에 들어가 런타임 실패하는 것을 타입에서 차단.
