# Task 01 — 스키마 + migration (WorkflowTaskEvent·MailDelivery 보강)

`WorkflowTaskEvent` 테이블·`MailDeliveryStatus` enum을 신설하고 `MailDelivery`를 보강한다. 기존 컬럼은 변경하지 않으며(파괴적 migration 회피), migration은 hand-author한다.

## Files

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260619120000_phase4_workflow_events/migration.sql`
- Create (test): `tests/prisma/schema-phase4.test.ts`

## Prep

- 엔트리포인트 §Shared Contracts **SC-1**(스키마 변경 전체 형태).
- Spec §4(데이터 모델 변경) — 특히 §4.2 migration 안전성(빈 테이블, 2단 status default, 부분 unique 인덱스).
- 기존 migration 포맷: `prisma/migrations/20260617225534_init/migration.sql`(enum/table/index/FK DDL 스타일).
- `MailDelivery`는 현재 빈 테이블(`src/`·seed 어디서도 미사용, cutover 전) → backfill 불필요.

## Deps

없음. (다만 이후 Task 03·06·07·10이 생성된 Prisma 타입에 의존하므로 가장 먼저 실행.)

## Step 1 — 실패 테스트 (생성된 enum/타입 부재 확인)

생성: `tests/prisma/schema-phase4.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { MailDeliveryStatus, Prisma } from "@prisma/client";

describe("Phase 4 schema", () => {
  it("MailDeliveryStatus enum 3종이 생성되어 있다", () => {
    expect(MailDeliveryStatus.SENDING).toBe("SENDING");
    expect(MailDeliveryStatus.SENT).toBe("SENT");
    expect(MailDeliveryStatus.FAILED).toBe("FAILED");
  });

  it("WorkflowTaskEvent 모델이 Prisma DMMF에 존재한다", () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models).toContain("WorkflowTaskEvent");
  });

  it("MailDelivery에 status/bodyHtml/errorMessage 필드가 있고 sentAt은 nullable이다", () => {
    const mail = Prisma.dmmf.datamodel.models.find((m) => m.name === "MailDelivery")!;
    const byName = Object.fromEntries(mail.fields.map((f) => [f.name, f]));
    expect(byName.status).toBeDefined();
    expect(byName.bodyHtml).toBeDefined();
    expect(byName.errorMessage).toBeDefined();
    expect(byName.sentAt.isRequired).toBe(false);
  });
});
```

## Step 2 — FAIL 확인

```bash
npm test -- tests/prisma/schema-phase4.test.ts
```

기대: 컴파일 또는 단언 실패(`MailDeliveryStatus` 미존재 / `WorkflowTaskEvent` 미존재 / `sentAt` required).

## Step 3 — schema.prisma 편집 (4개 변경)

**(a) `MailDeliveryStatus` enum 추가** — `WorkflowStatus` enum 블록 바로 뒤에 삽입:

```prisma
enum MailDeliveryStatus {
  SENDING
  SENT
  FAILED

  @@schema("workflows")
}
```

**(b) `WorkflowTask` 역관계 추가** — 기존 relations 블록을 다음으로 교체:

```prisma
  files          GeneratedFile[]
  mailDeliveries MailDelivery[]
  events         WorkflowTaskEvent[]
```

**(c) `MailDelivery` 모델 보강** — 모델 전체를 다음으로 교체:

```prisma
model MailDelivery {
  id                String             @id @default(cuid())
  taskId            String?
  task              WorkflowTask?      @relation(fields: [taskId], references: [id], onDelete: SetNull)
  step              String?
  status            MailDeliveryStatus
  recipients        Json
  subject           String
  bodyHtml          String?
  attachmentPaths   Json?
  providerMessageId String?
  errorMessage      String?
  sentById          String?
  sentAt            DateTime?

  @@index([taskId])
  @@index([sentAt])
  @@schema("workflows")
}
```

> `status`에 `@default`를 두지 말 것. 이유: 앱이 항상 명시적 status로 insert하므로(§6.2) default가 불필요하고, 부분 unique 인덱스의 의미(활성 상태만)와 충돌할 여지를 없앤다. 컬럼 추가 안전성은 migration의 2단 SQL이 담당한다.

**(d) `WorkflowTaskEvent` 모델 추가** — `MailDelivery` 모델 블록 바로 뒤에 삽입:

```prisma
model WorkflowTaskEvent {
  id         String          @id @default(cuid())
  taskId     String
  task       WorkflowTask    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fromStatus WorkflowStatus?
  toStatus   WorkflowStatus
  actorId    String?
  note       String?
  occurredAt DateTime        @default(now())

  @@index([taskId, occurredAt])
  @@schema("workflows")
}
```

## Step 4 — migration SQL hand-author

생성: `prisma/migrations/20260619120000_phase4_workflow_events/migration.sql`

```sql
-- CreateEnum
CREATE TYPE "workflows"."MailDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- AlterTable: MailDelivery.status — 2단(임시 default로 추가 후 제거). 빈 테이블이라 backfill 불필요하나
-- 향후 행이 있어도 NOT NULL 추가가 안전하도록 임시 default를 거친 뒤 제거한다(§4.2).
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "status" "workflows"."MailDeliveryStatus" NOT NULL DEFAULT 'SENDING';
ALTER TABLE "workflows"."MailDelivery" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable: MailDelivery 신규 컬럼 + sentAt nullable/no-default
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "bodyHtml" TEXT;
ALTER TABLE "workflows"."MailDelivery" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "workflows"."MailDelivery" ALTER COLUMN "sentAt" DROP NOT NULL;
ALTER TABLE "workflows"."MailDelivery" ALTER COLUMN "sentAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "workflows"."WorkflowTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "workflows"."WorkflowStatus",
    "toStatus" "workflows"."WorkflowStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTaskEvent_taskId_occurredAt_idx" ON "workflows"."WorkflowTaskEvent"("taskId", "occurredAt");

-- AddForeignKey
ALTER TABLE "workflows"."WorkflowTaskEvent" ADD CONSTRAINT "WorkflowTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflows"."WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: (taskId, step) 부분 unique — 활성(SENDING/SENT) 발송의 중복 SMTP 차단(§4.2·§6.2).
-- Prisma 스키마로 표현 불가하므로 raw SQL로만 존재한다(애플리케이션 tx 가드가 1차 방어, 이 인덱스는 경합 백스톱).
CREATE UNIQUE INDEX "MailDelivery_taskId_step_active_key" ON "workflows"."MailDelivery"("taskId", "step") WHERE "taskId" IS NOT NULL AND "status" IN ('SENDING', 'SENT');
```

## Step 5 — generate + validate (PASS)

```bash
npm run prisma:validate
npm run prisma:generate
npm test -- tests/prisma/schema-phase4.test.ts
```

기대: validate OK, generate가 새 타입 출력, 테스트 PASS.

## Step 6 — commit

```bash
git add prisma/schema.prisma prisma/migrations/20260619120000_phase4_workflow_events tests/prisma/schema-phase4.test.ts
git commit -m "feat(workflows): add WorkflowTaskEvent + MailDelivery status/body/error schema (phase 4)"
```

## Acceptance Criteria

```bash
npm run prisma:validate    # 스키마 유효
npm run prisma:generate    # @prisma/client 재생성(새 enum·모델 포함)
npm run typecheck          # 통과(아직 새 타입 소비처 없음)
npm run lint               # 통과
npm test                   # 전체 통과(신규 schema-phase4 테스트 포함)
```

## Cautions

- **`prisma migrate dev`를 이 태스크에서 실행하지 말 것.** 이유: 로컬/CI에 DB가 없을 수 있고, 본 저장소는 lint/typecheck/build/test를 DB 없이 통과시키는 관례다. migration SQL은 hand-author하고 실제 적용은 DB 연결 시(또는 cutover 시) 수행한다. 타입 생성은 `prisma generate`만으로 충분하다.
- **`status`에 `@default`를 넣지 말 것.** 이유: 2단 migration이 컬럼 안전성을 담당하고, 앱은 항상 명시적 status로 insert한다(§6.2).
- **부분 unique 인덱스를 schema.prisma로 옮기려 하지 말 것.** 이유: Prisma는 partial index를 모델링하지 못한다. raw SQL migration에만 둔다. 이후 `prisma migrate dev` 자동 생성 시 이 인덱스를 drop하려는 drift가 보이면 **유지**하도록 손으로 보정한다(앱 tx 가드가 1차 방어이므로 치명적이지는 않으나 백스톱을 잃지 말 것).
- 기존 `WorkflowTask.generatedAt/reviewedAt/sentAt` 컬럼을 제거하지 말 것(§4.3, 전이 엔진이 stamp).
