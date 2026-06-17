# Task 03 — Prisma 클라이언트 싱글톤 + 첫 마이그레이션

목적: 모든 서버 코드가 쓰는 Prisma 클라이언트 싱글톤(`src/lib/prisma`)을 만들고, 재구성된 스키마로 **첫 마이그레이션(`--name init`)** 을 생성·적용한다.

## Files

- Create: `src/lib/prisma/index.ts`
- Create: `tests/lib/prisma.test.ts`
- Create(생성됨): `prisma/migrations/<timestamp>_init/migration.sql` (prisma가 생성)

## Prep

- §Shared Contracts **SC-8**(Prisma 클라이언트·트랜잭션 타입), **SC-10**(검증 명령·DB 필요).
- `.env`에 `DATABASE_URL`이 있어야 한다(`.env.example` 참조). 로컬 PostgreSQL 접속 정보는 `workspace-env/INVENTORY.md`.

## Deps

01(툴링), 02(스키마).

## Steps

### 1. `.env` 확인

`.env`가 없으면 `.env.example`을 복사해 `DATABASE_URL`을 실제 로컬 DB로 채운다. DB가 떠 있어야 Step 4가 동작한다.

### 2. Prisma 클라이언트 싱글톤 — `src/lib/prisma/index.ts`

```ts
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type PrismaTx = Prisma.TransactionClient;
```

### 3. Prisma Client 생성

```bash
npm run prisma:generate
```

기대: `Generated Prisma Client` 출력. 이때부터 `@prisma/client` 타입이 새 스키마(모듈 모델의 plain userId, OutboxEvent 등)를 반영한다.

### 4. 첫 마이그레이션 생성·적용 (DB 필요)

```bash
npx prisma migrate dev --name init
```

기대:
- `prisma/migrations/<timestamp>_init/migration.sql` 생성(`<timestamp>`는 prisma가 붙이는 `YYYYMMDDHHMMSS` 접두사 — `0001`이 아님). 그 안에 `CREATE SCHEMA "kernel"`, `"workflows"`, `"leave"`, `"calendar"`와 각 테이블 DDL이 포함된다.
- 마이그레이션이 로컬 DB에 적용되고 `Your database is now in sync` 출력.

마이그레이션 SQL을 열어 다음을 눈으로 확인:
- 4개 스키마가 모두 `CREATE SCHEMA`로 생성된다.
- `CalendarEvent`에 `workflowTaskId`/`leaveRequestId` 컬럼이 **없고** `originModule`/`originId`가 **있다**.
- 모듈 테이블에서 `User`로의 FOREIGN KEY가 **없다**(plain userId).
- `kernel.OutboxEvent` 테이블이 있다.

### 5. 클라이언트 구성 smoke test — `tests/lib/prisma.test.ts`

DB 연결 없이 클라이언트가 구성되고 타입이 존재하는지 확인한다(연결은 하지 않는다).

```ts
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

describe("prisma client", () => {
  it("is a constructed singleton exposing model delegates", () => {
    expect(prisma).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.outboxEvent).toBeDefined();
  });
});
```

### 6. 검증

```bash
npm run typecheck             # prisma 타입 반영, 에러 0
npm test                      # prisma 구성 테스트 통과
npx prisma migrate status     # "Database schema is up to date" (DB 필요)
```

### 7. 커밋

```bash
git add -A
git commit -m "Add prisma client singleton and initial migration"
```

## Acceptance Criteria

- `src/lib/prisma/index.ts`가 `prisma` 싱글톤과 `PrismaTx` 타입을 export한다.
- `prisma/migrations/<timestamp>_init/migration.sql`이 존재하고 4개 스키마를 생성한다.
- 마이그레이션 SQL에 `CalendarEvent`의 `originModule`/`originId`가 있고 `workflowTaskId`/`leaveRequestId`가 없다.
- `npm run typecheck` 에러 0, `npm test` 통과, `npx prisma migrate status`가 최신 상태.

## Cautions

- **Don't 마이그레이션을 손으로 작성하지 마라. Reason:** `prisma migrate dev`가 multiSchema의 `CREATE SCHEMA`까지 정확히 만든다. 손수 작성은 drift를 부른다.
- **Don't DB 없이 task를 "완료"로 표시하지 마라. Reason:** Step 4/6은 로컬 PostgreSQL이 필요하다(roadmap Phase 1 완료기준 "마이그레이션 실행 가능"). DB가 없으면 띄운 뒤 진행한다 — `prisma:validate`만으로는 충분치 않다.
- **Don't PrismaClient를 여러 곳에서 `new` 하지 마라. Reason:** dev HMR에서 커넥션이 폭증한다. 항상 이 싱글톤을 import한다.
