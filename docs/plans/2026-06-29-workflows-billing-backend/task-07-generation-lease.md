# Task 07 — GenerationLock lease (스키마 + 마이그레이션 + repo CAS)

**Purpose:** generate 직렬화 primitive(J1 = lease)를 신설한다. 별도 `GenerationLock` 테이블 + Prisma-native CAS(`acquire`/`release`)로 같은 taskId의 동시 generate를 직렬화하고, FS I/O 동안 DB를 점유하지 않으며(I2), 만료 기반 steal로 보유자 crash를 복구한다(spec §8.2 step 0, entrypoint J1).

## Files

- **Modify:** `prisma/schema.prisma` — `GenerationLock` 모델 추가(§Shared Contracts SC-3)
- **Create:** `prisma/migrations/<timestamp>_add_generation_lock/migration.sql` — `prisma migrate dev`로 생성(아래 SQL과 동일해야 함)
- **Create:** `src/modules/workflows/repositories/generation-lock.ts` — `acquireGenerationLease`/`releaseGenerationLease`(§Shared Contracts SC-3)
- **Create (test):** `tests/modules/workflows/generation-lock.test.ts`

## Prep

- 읽기: spec §8.2 step 0(직렬화·tx 미점유·연결 일관성·크래시 해제 계약), entrypoint J1·§Shared Contracts SC-3.
- multiSchema: `GenerationLock`은 `@@schema("workflows")`라 raw SQL에서 **테이블명을 `workflows."GenerationLock"`로 스키마 한정 필수**(memory: ?schema 제거만으론 안 됨 — 스키마 한정해야).
- CAS 원리: `INSERT … ON CONFLICT ("taskId") DO UPDATE … WHERE … "lockedUntil" < now()`는 단일 SQL 문이라 **원자적**이다. 동시 2건이 동시에 실행해도 Postgres가 행 잠금으로 직렬화 → 정확히 하나만 affected-rows=1.

## Deps

없음.

## TDD steps

### 1. schema 추가 — `prisma/schema.prisma`

`BillingRoundDate` 모델 **다음에** 추가:

```prisma
model GenerationLock {
  taskId      String   @id
  holder      String   // 요청별 식별자(reqId = crypto.randomUUID())
  lockedUntil DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@schema("workflows")
}
```

### 2. client 생성 + 검증

```bash
npm run prisma:validate
npm run prisma:generate
```

(`prisma:generate`는 DB 불필요 — schema에서 client 타입만 생성. 이후 `prisma`에 `generationLock` 모델 타입이 생겨 typecheck 통과.)

### 3. 실패 테스트 작성 — `tests/modules/workflows/generation-lock.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { $executeRaw: vi.fn() } }));

import { prisma } from "@/lib/prisma";
import { acquireGenerationLease, releaseGenerationLease, GENERATION_LEASE_TTL_MS } from "@/modules/workflows/repositories/generation-lock";

const exec = (prisma as unknown as { $executeRaw: ReturnType<typeof vi.fn> }).$executeRaw;

beforeEach(() => { exec.mockReset(); });

describe("acquireGenerationLease (J1 CAS)", () => {
  it("affected-rows 1 → true(점유 성공)", async () => {
    exec.mockResolvedValue(1);
    expect(await acquireGenerationLease("t1", "h1")).toBe(true);
  });
  it("affected-rows 0 → false(타인이 유효 lease 보유 → 호출부 409)", async () => {
    exec.mockResolvedValue(0);
    expect(await acquireGenerationLease("t1", "h2")).toBe(false);
  });
  it("기본 TTL은 2분", () => {
    expect(GENERATION_LEASE_TTL_MS).toBe(120_000);
  });
});

describe("releaseGenerationLease", () => {
  it("DELETE 실행(holder 일치 시만 — steal된 lease는 안 지움)", async () => {
    exec.mockResolvedValue(1);
    await releaseGenerationLease("t1", "h1");
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
```

### 4. 실행 → FAIL

```bash
npm test -- tests/modules/workflows/generation-lock.test.ts
```

### 5. repo 구현 — `src/modules/workflows/repositories/generation-lock.ts`

```ts
import "server-only";
import { prisma } from "@/lib/prisma";

export const GENERATION_LEASE_TTL_MS = 120_000; // 2분. HWPX 4종 zip은 보통 수초, 안전마진.

// CAS 점유: lease가 없거나 만료(lockedUntil < now)일 때만 1행. 반환 true=점유, false=타인 보유(409).
// 단일 SQL 문이라 원자적 — 동시 2건도 Postgres 행 잠금으로 직렬화돼 하나만 affected=1.
// expiry는 JS 클럭으로 계산(단일 서버, 2분 TTL이라 스큑 무시 가능). 만료 비교는 DB now()로.
export async function acquireGenerationLease(
  taskId: string, holder: string, ttlMs = GENERATION_LEASE_TTL_MS,
): Promise<boolean> {
  const lockedUntil = new Date(Date.now() + ttlMs);
  const affected = await prisma.$executeRaw`
    INSERT INTO workflows."GenerationLock" ("taskId", "holder", "lockedUntil", "createdAt", "updatedAt")
    VALUES (${taskId}, ${holder}, ${lockedUntil}, now(), now())
    ON CONFLICT ("taskId") DO UPDATE
      SET "holder" = EXCLUDED."holder", "lockedUntil" = EXCLUDED."lockedUntil", "updatedAt" = now()
      WHERE workflows."GenerationLock"."lockedUntil" < now()
  `;
  return affected === 1;
}

// holder 일치 시만 삭제(steal된 경우 내 holder가 아니므로 0행 — 남의 lease 보호).
export async function releaseGenerationLease(taskId: string, holder: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM workflows."GenerationLock"
    WHERE "taskId" = ${taskId} AND "holder" = ${holder}
  `;
}
```

### 6. 실행 → PASS

```bash
npm test -- tests/modules/workflows/generation-lock.test.ts
```

### 7. 마이그레이션 생성(DB 연결 환경 — 로컬 또는 dev)

```bash
npx prisma migrate dev --name add_generation_lock
```

생성된 `migration.sql`이 다음과 **동일**한지 확인(다르면 schema 재검토):

```sql
CREATE TABLE "workflows"."GenerationLock" (
    "taskId" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenerationLock_pkey" PRIMARY KEY ("taskId")
);
```

(DB가 없는 환경에서는 이 단계를 건너뛰고 schema·코드·테스트만 커밋. 마이그레이션은 dev 배포 시 `prisma migrate deploy`로 적용 — 비파괴 테이블 추가라 **표준 restart**, full-stop 불필요.)

### 8. commit

```bash
git add prisma/schema.prisma prisma/migrations src/modules/workflows/repositories/generation-lock.ts tests/modules/workflows/generation-lock.test.ts
git commit -m "feat(workflows): GenerationLock lease(CAS 직렬화, J1) + 마이그레이션"
```

## Acceptance Criteria

- `npm test -- tests/modules/workflows/generation-lock.test.ts` 전건 PASS.
- `npm run prisma:validate` / `npm run typecheck`(`prisma.generationLock`/`$executeRaw` 타입) / `npm run lint` / `npm run build` 통과.
- CAS 원자성은 단일 `INSERT … ON CONFLICT … WHERE` 문이 보장. **동시 2건 시나리오(1진행·1 409)는 task-08 `runGenerate`에서 lease를 mock해 검증**하고, 실제 DB 원자성·만료 steal은 dev 배포 검증(spec §8.2 AC).

## Cautions

- **Don't** raw SQL에서 테이블명을 `"GenerationLock"`(스키마 미한정)로 쓰지 말 것. Reason: multiSchema라 `workflows."GenerationLock"`로 스키마 한정해야 한다(미한정 시 런타임 relation-not-found).
- **Don't** session-level `pg_advisory_lock`을 쓰지 말 것. Reason: J1에서 기각 — Prisma 풀이 커넥션 pinning을 보장하지 않아 lock이 샌다. lease(테이블 CAS)가 확정 primitive.
- **Don't** `acquire`를 `$transaction` 안에서 호출하고 그 tx 안에서 FS를 돌리지 말 것. Reason: I2 위배(FS 동안 DB 점유·풀 고갈). lease는 짧은 단일 문이고, FS는 lease 보유 중이되 **DB tx 밖**에서 수행(task-08).
- **Don't** `release`를 holder 조건 없이 하지 말 것. Reason: 만료 후 다른 요청이 steal한 lease를 원래(느린) 보유자가 지워버리면 상호배제가 깨진다. `WHERE holder = ?`로 보호.
