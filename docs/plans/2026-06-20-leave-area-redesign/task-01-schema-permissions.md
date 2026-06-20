# Task 01 — schema 필드·메일 outbox·권한 catalog + migration

**목적:** 관리자 귀속/soft-delete 필드(LeaveRequest)와 메일 outbox 필드/상태(MailDelivery)를 스키마에 추가하고, 신규 권한 resource 2종을 catalog에 등록한다. 이후 모든 태스크의 데이터 기반.

## Files
- Modify: `prisma/schema.prisma` (LeaveRequest, MailDelivery, MailDeliveryStatus)
- Modify: `src/kernel/access/catalog.ts` (RESOURCES 배열)
- Modify: `src/app/(app)/workflows/labels.ts` (공유 enum 확장 호환 — MailStatus·MAIL_LABEL·MAIL_VARIANT)
- Modify: `tests/prisma/schema-phase4.test.ts` (MailDeliveryStatus 5종 반영)
- Create: `prisma/migrations/<ts>_leave_area_redesign/migration.sql`
- Create: `tests/kernel/access/catalog.test.ts`

## Prep
- 엔트리포인트 §SC-2(권한 키), §SC-3(Schema 변경) 정독.
- 기존 스키마: `LeaveRequest` @@schema("leave") line ~511, `MailDelivery`/`MailDeliveryStatus` @@schema("workflows") line ~397/80.
- seed 흐름: `prisma/seed.ts` line 13 `const VIEW_RESOURCES = [...RESOURCES]` → catalog `RESOURCES`에 추가하면 `:view`가 자동 생성됨.

## Deps
없음.

## Steps

### 1. (TDD) catalog 회귀 테스트 작성 → FAIL

`tests/kernel/access/catalog.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RESOURCES } from "@/kernel/access/catalog";

describe("access catalog — leave 관리자 권한 resource", () => {
  it("leave.status·leave.admin resource가 카탈로그에 있다(=> :view 자동 seed)", () => {
    expect(RESOURCES).toContain("leave.status");
    expect(RESOURCES).toContain("leave.admin");
  });
  it("기존 leave resource를 보존한다", () => {
    expect(RESOURCES).toContain("leave.request");
    expect(RESOURCES).toContain("leave.approval");
    expect(RESOURCES).toContain("leave.allocation");
  });
});
```
실행: `npx vitest run tests/kernel/access/catalog.test.ts` → **FAIL**(leave.status/admin 없음).

### 2. catalog에 resource 2종 추가 → PASS

`src/kernel/access/catalog.ts` — `RESOURCES` 배열의 leave 줄을 교체:
```ts
  "leave.request", "leave.approval", "leave.allocation", "leave.status", "leave.admin",
```
**주의: NAV 배열은 건드리지 않는다.** 이유: 가로 탭은 NavigationItem이 아니라 별도 컴포넌트(Task 04)다. NAV에 추가하면 좌측 글로벌 네비에 중복 항목이 생긴다.

실행: 위 테스트 → **PASS**.

### 3. schema.prisma — LeaveRequest 필드 추가

`LeaveRequest` 모델의 `updatedAt` 줄 다음, `@@index` 줄들 **앞에** 추가:
```prisma
  createdByAdminId   String?
  createdByAdminAt   DateTime?
  modifiedByAdminId  String?
  modifiedByAdminAt  DateTime?
  deletedByAdminId   String?
  deletedAt          DateTime?
  deleteReason       String?
```
그리고 인덱스 블록에 추가:
```prisma
  @@index([deletedAt])
```

### 4. schema.prisma — MailDelivery 필드/인덱스 추가

`MailDelivery` 모델의 `sentAt` 줄 다음, `@@index` 줄들 앞에 추가:
```prisma
  leaveRequestId String?
  eventType      String?
  attempts       Int       @default(0)
  lockedUntil    DateTime?
  workerId       String?
```
인덱스 블록에 추가:
```prisma
  @@unique([leaveRequestId, eventType])
  @@index([leaveRequestId])
  @@index([status, lockedUntil])
```
**주의: `leaveRequestId`에 relation을 만들지 않는다.** 이유: `MailDelivery`는 workflows 스키마, `LeaveRequest`는 leave 스키마 — cross-schema FK는 결합·migration 복잡도를 키운다. id 문자열만 보관(spec §8).

### 5. schema.prisma — MailDeliveryStatus enum 확장

```prisma
enum MailDeliveryStatus {
  PENDING
  SENDING
  SENT
  FAILED
  CANCELLED

  @@schema("workflows")
}
```

### 5b. 공유 enum 확장 — workflow 소비자 호환 (finding)

`MailDeliveryStatus`는 **workflows 스키마의 공유 enum**이라 기존 workflow 소비자도 확장값을 타입·렌더에서 커버해야 한다. 확인된 사실:
- 서비스 `src/modules/workflows/services/tasks.ts`의 `MailView.status`는 **이미 Prisma `MailDeliveryStatus`**를 쓰므로 추가 변경 불필요(확장 시 그대로 wide). repo 인터페이스(`repositories/index.ts`·`mail.ts`)도 Prisma 타입 사용 — 변경 불필요.
- 깨지는 실제 지점은 (a) **클라이언트** `src/app/(app)/workflows/labels.ts`의 손수 작성 좁은 union·라벨 맵, (b) enum "3종"을 명시한 **테스트**다. (워크플로 태스크는 leave 메일 행(`taskId=null`, `leaveRequestId≠null`)을 조회하지 않으므로 런타임에 PENDING/CANCELLED를 만나진 않지만, 공유 enum 전체를 타입·렌더로 커버해 두는 게 안전.)

**(a) `src/app/(app)/workflows/labels.ts`** — `MailStatus`를 확장하고 라벨/배지를 5종 전체로:
```ts
export type MailStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
// 메일 배지: SENDING은 '확인 필요'(발송 불확실)로 표시(spec §10). PENDING/CANCELLED는 공유 테이블의 leave 메일용 — 워크플로엔 거의 안 나타나나 타입·렌더 커버.
export const MAIL_LABEL: Record<MailStatus, string> = { PENDING: "대기 중", SENDING: "확인 필요", SENT: "발송됨", FAILED: "실패", CANCELLED: "취소됨" };
export const MAIL_VARIANT: Record<MailStatus, BadgeVariant> = { PENDING: "outline", SENDING: "outline", SENT: "default", FAILED: "destructive", CANCELLED: "secondary" };
```
(`MAIL_LABEL`/`MAIL_VARIANT`가 `Record<MailStatus,...>`라 union을 넓히면 5종 모두 키가 있어야 typecheck 통과 — 위처럼 추가.)

**(b) `tests/prisma/schema-phase4.test.ts`** — `MailDeliveryStatus`가 5종임을 반영(제목 "3종"→"5종", PENDING/CANCELLED 존재 단언 추가). 기존 SENDING/SENT/FAILED 단언은 유지.

### 6. migration 생성

**DB 연결이 가능하면(권장):**
```bash
npm run prisma:migrate -- --name leave_area_redesign   # = prisma migrate dev --name ...
```
prisma가 `prisma/migrations/<ts>_leave_area_redesign/migration.sql`을 자동 생성한다.

**DB가 없으면 수동 작성**(`prisma/migrations/<생성시각 14자리>_leave_area_redesign/migration.sql`):
```sql
-- AlterEnum (Postgres: ADD VALUE는 개별 실행)
ALTER TYPE "workflows"."MailDeliveryStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "workflows"."MailDeliveryStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable: LeaveRequest 관리자 귀속·soft-delete
ALTER TABLE "leave"."LeaveRequest"
  ADD COLUMN "createdByAdminId"  TEXT,
  ADD COLUMN "createdByAdminAt"  TIMESTAMP(3),
  ADD COLUMN "modifiedByAdminId" TEXT,
  ADD COLUMN "modifiedByAdminAt" TIMESTAMP(3),
  ADD COLUMN "deletedByAdminId"  TEXT,
  ADD COLUMN "deletedAt"         TIMESTAMP(3),
  ADD COLUMN "deleteReason"      TEXT;
CREATE INDEX "LeaveRequest_deletedAt_idx" ON "leave"."LeaveRequest"("deletedAt");

-- AlterTable: MailDelivery outbox
ALTER TABLE "workflows"."MailDelivery"
  ADD COLUMN "leaveRequestId" TEXT,
  ADD COLUMN "eventType"      TEXT,
  ADD COLUMN "attempts"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil"    TIMESTAMP(3),
  ADD COLUMN "workerId"       TEXT;
CREATE UNIQUE INDEX "MailDelivery_leaveRequestId_eventType_key" ON "workflows"."MailDelivery"("leaveRequestId", "eventType");
CREATE INDEX "MailDelivery_leaveRequestId_idx" ON "workflows"."MailDelivery"("leaveRequestId");
CREATE INDEX "MailDelivery_status_lockedUntil_idx" ON "workflows"."MailDelivery"("status", "lockedUntil");
```
**주의: enum value를 추가하는 migration에서는 그 새 value를 같은 트랜잭션에서 사용하지 않는다.** Postgres는 `ALTER TYPE ADD VALUE` 후 동일 트랜잭션 내 사용을 막는다. 여기선 사용하지 않으므로 안전.

### 7. client 재생성 + 검증
```bash
npm run prisma:generate
```

## Acceptance Criteria
- `npm run prisma:validate` → 스키마 유효(`The schema is valid`).
- `npx vitest run tests/kernel/access/catalog.test.ts` → 2 passed.
- `npm run prisma:generate && npm run typecheck` → 에러 0(신규 필드가 `@prisma/client` 타입에 반영; 공유 `MailDeliveryStatus` 확장 후 workflow `labels.ts`가 5종을 커버해 통과).
- `npx vitest run tests/prisma/schema-phase4.test.ts` → MailDeliveryStatus 5종 반영 후 passed.
- `npm run lint` → 통과.

## Cautions
- **Don't** NAV 카탈로그에 leave.status/admin을 추가하지 마라. 이유: 좌측 글로벌 네비에 중복 메뉴가 생기고, 탭은 Task 04에서 별도 구현한다.
- **Don't** `leaveRequestId`에 Prisma relation(`@relation`)을 걸지 마라. 이유: cross-schema(workflows↔leave) FK는 multiSchema에서 불필요한 결합을 만든다.
- **Don't** 기존 `SENDING/SENT/FAILED` enum 순서를 바꾸지 마라(기존 행 영향). 새 value만 추가.
