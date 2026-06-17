# Task 02 — schema.prisma 재구성 (multiSchema · 소프트참조 · 커널정리 · outbox)

목적: 마이그레이션이 아직 없는 지금(변경비용 최저) `prisma/schema.prisma`를 spec §7대로 재구성한다 — multiSchema 소유 표시, CalendarEvent 소프트 참조, 커널→모듈 역참조 제거(plain userId), OutboxEvent 신설.

## Files

- Modify: `prisma/schema.prisma` (전체 교체 — 아래 전문)

## Prep

- §Shared Contracts **SC-2**(스키마 규약), **SC-3**(OutboxEvent).
- spec §7 "schema.prisma 변경", §12(이번 결정: multiSchema 1단계 도입 / plain userId, FK 없음).

## Deps

없음(스키마 텍스트만 수정). 마이그레이션 실행은 task-03.

## Steps

### 1. `prisma/schema.prisma` 전체를 아래로 교체

핵심 변경(기존 대비):
- generator `previewFeatures = ["multiSchema"]`, datasource `schemas = [...]`.
- 모든 모델·enum에 `@@schema(...)`.
- `User`에서 모듈 역참조 컬렉션 8개 제거(`workflowTasks`·`mailDeliveries`·`leaveAllocations`·`leaveRequests`·`reviewedLeaveRequests`·`allocationChanges`·`ownedCalendarSources`·`calendarEvents`). 커널 내부 관계(`roleAssignments`·`permissionOverrides`·`auditLogs`)는 유지.
- 모듈 모델의 `User` 관계 → plain `userId`/`createdById`/`reviewedById`/`ownerUserId`/`sentById`(relation·FK 없음).
- `CalendarEvent`: `workflowTask`/`leaveRequest` 관계 + `workflowTaskId`/`leaveRequestId` + 두 인덱스 제거 → `originModule`/`originId` + 인덱스. `user` 관계 제거(plain `userId` 유지). `source`(CalendarSource feed) 관계는 유지.
- `WorkflowTask.calendarEvents`·`LeaveRequest.calendarEvents` 역참조 제거.
- `OutboxEvent` + `OutboxStatus` 신설(kernel).

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["kernel", "workflows", "leave", "calendar"]
}

enum SystemRole {
  OWNER
  ADMIN
  MANAGER
  MEMBER

  @@schema("kernel")
}

enum UserStatus {
  INVITED
  ACTIVE
  DISABLED

  @@schema("kernel")
}

enum EmploymentType {
  REGULAR
  CONTRACTOR

  @@schema("kernel")
}

enum JobFunction {
  PM
  DEVELOPER
  CONTENT_MANAGER
  CIVIL_RESPONSE

  @@schema("kernel")
}

enum PermissionEffect {
  ALLOW
  DENY

  @@schema("kernel")
}

enum OutboxStatus {
  PENDING
  DONE
  FAILED

  @@schema("kernel")
}

enum WorkflowKind {
  WEEKLY_REPORT
  BILLING
  NOTIFICATION_BILLING

  @@schema("workflows")
}

enum WorkflowStatus {
  PENDING
  GENERATED
  REVIEWED
  SENT
  HQ_REQUESTED
  FINAL_SENT
  CANCELLED

  @@schema("workflows")
}

enum LeaveType {
  ANNUAL
  HALF
  QUARTER

  @@schema("leave")
}

enum LeaveSubType {
  MORNING
  AFTERNOON

  @@schema("leave")
}

enum LeaveRequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED

  @@schema("leave")
}

enum AllocationChangeType {
  INITIAL
  ADD
  DEDUCT
  CARRYOVER
  ADJUSTMENT

  @@schema("leave")
}

enum CalendarSourceKind {
  INTERNAL_LEAVE
  WORKFLOW
  GOOGLE_CALENDAR
  HOLIDAY
  MANUAL

  @@schema("calendar")
}

enum CalendarEventKind {
  WORKFLOW_TASK
  INTERNAL_LEAVE
  EXTERNAL_VACATION
  EXTERNAL_EVENT
  HOLIDAY
  PERSONAL_EVENT
  TEAM_EVENT

  @@schema("calendar")
}

enum CalendarVisibility {
  PRIVATE
  TEAM
  INTERNAL
  PUBLIC

  @@schema("calendar")
}

enum CalendarSyncStatus {
  ACTIVE
  PAUSED
  ERROR

  @@schema("calendar")
}

enum CalendarDedupStatus {
  UNIQUE
  DUPLICATE_OF_INTERNAL
  DUPLICATE_OF_EXTERNAL
  IGNORED

  @@schema("calendar")
}

model User {
  id             String         @id @default(cuid())
  email          String         @unique
  passwordHash   String
  name           String
  department     String?
  position       String?
  joinDate       DateTime?
  employmentType EmploymentType
  jobFunction    JobFunction
  systemRole     SystemRole     @default(MEMBER)
  status         UserStatus     @default(ACTIVE)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  roleAssignments     UserAccessRole[]
  permissionOverrides UserPermissionOverride[]
  auditLogs           AuditLog[]               @relation("AuditActor")

  @@index([employmentType, jobFunction])
  @@index([systemRole])
  @@schema("kernel")
}

model AccessRole {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  description String?
  isSystem    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users       UserAccessRole[]
  permissions RolePermission[]

  @@schema("kernel")
}

model Permission {
  id          String   @id @default(cuid())
  resource    String
  action      String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  roles         RolePermission[]
  userOverrides UserPermissionOverride[]
  menuItems     NavigationItem[]

  @@unique([resource, action])
  @@schema("kernel")
}

model RolePermission {
  id           String           @id @default(cuid())
  roleId       String
  role         AccessRole       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permissionId String
  permission   Permission       @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  effect       PermissionEffect @default(ALLOW)
  scope        String           @default("all")
  conditions   Json?
  createdAt    DateTime         @default(now())

  @@unique([roleId, permissionId, scope])
  @@index([permissionId])
  @@schema("kernel")
}

model UserAccessRole {
  id        String     @id @default(cuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  roleId    String
  role      AccessRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  startsAt  DateTime?
  endsAt    DateTime?
  createdAt DateTime   @default(now())

  @@unique([userId, roleId])
  @@index([roleId])
  @@schema("kernel")
}

model UserPermissionOverride {
  id           String           @id @default(cuid())
  userId       String
  user         User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  permissionId String
  permission   Permission       @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  effect       PermissionEffect
  scope        String           @default("all")
  reason       String?
  startsAt     DateTime?
  endsAt       DateTime?
  createdAt    DateTime         @default(now())

  @@unique([userId, permissionId, scope])
  @@index([permissionId])
  @@schema("kernel")
}

model NavigationItem {
  id                   String           @id @default(cuid())
  key                  String           @unique
  label                String
  href                 String?
  parentId             String?
  parent               NavigationItem?  @relation("NavigationTree", fields: [parentId], references: [id])
  children             NavigationItem[] @relation("NavigationTree")
  sortOrder            Int              @default(0)
  requiredPermissionId String?
  requiredPermission   Permission?      @relation(fields: [requiredPermissionId], references: [id])
  isActive             Boolean          @default(true)
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt

  @@index([parentId, sortOrder])
  @@index([requiredPermissionId])
  @@schema("kernel")
}

model OutboxEvent {
  id          String       @id @default(cuid())
  type        String
  payload     Json
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  lastError   String?
  createdAt   DateTime     @default(now())
  processedAt DateTime?

  @@index([status, createdAt])
  @@schema("kernel")
}

model SystemSetting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())

  @@schema("kernel")
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  actor      User?    @relation("AuditActor", fields: [actorId], references: [id])
  entityType String
  entityId   String?
  action     String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([actorId, createdAt])
  @@schema("kernel")
}

model WorkflowType {
  id                String       @id
  kind              WorkflowKind @unique
  name              String
  description       String?
  templatePath      String
  recurrence        String
  defaultRecipients Json?
  isActive          Boolean      @default(true)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  tasks WorkflowTask[]

  @@schema("workflows")
}

model WorkflowTask {
  id          String         @id @default(cuid())
  typeId      String
  type        WorkflowType   @relation(fields: [typeId], references: [id])
  scheduledAt DateTime
  status      WorkflowStatus @default(PENDING)
  outputPath  String?
  recipients  Json?
  createdById String?
  generatedAt DateTime?
  reviewedAt  DateTime?
  sentAt      DateTime?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  files          GeneratedFile[]
  mailDeliveries MailDelivery[]

  @@index([typeId, scheduledAt])
  @@index([status])
  @@schema("workflows")
}

model GeneratedFile {
  id          String       @id @default(cuid())
  taskId      String
  task        WorkflowTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  path        String
  displayName String
  mimeType    String?
  sizeBytes   BigInt?
  createdAt   DateTime     @default(now())

  @@index([taskId])
  @@schema("workflows")
}

model MailDelivery {
  id                String        @id @default(cuid())
  taskId            String?
  task              WorkflowTask? @relation(fields: [taskId], references: [id], onDelete: SetNull)
  step              String?
  recipients        Json
  subject           String
  attachmentPaths   Json?
  providerMessageId String?
  sentById          String?
  sentAt            DateTime      @default(now())

  @@index([taskId])
  @@index([sentAt])
  @@schema("workflows")
}

model BillingConfig {
  id                String   @id @default(cuid())
  year              Int      @unique
  projectName       String
  contractNumber    String
  contractAmount    BigInt
  monthlyAmount     BigInt
  contractAmountKor String   @default("")
  monthlyAmountKor  String   @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@schema("workflows")
}

model BillingRoundDate {
  id         String   @id @default(cuid())
  year       Int
  round      Int
  submitDate DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([year, round])
  @@index([year])
  @@schema("workflows")
}

model Deliverable {
  id             String   @id @default(cuid())
  year           Int
  label          String
  completionDate String?
  progress       String?
  delayReason    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([year, label])
  @@index([year])
  @@schema("workflows")
}

model LeaveAllocation {
  id                    String    @id @default(cuid())
  userId                String
  year                  Int
  allocatedDays         Decimal   @db.Decimal(6, 2)
  carriedOverDays       Decimal   @default(0) @db.Decimal(6, 2)
  carriedOverExpiryDate DateTime?
  usedDays              Decimal   @default(0) @db.Decimal(6, 2)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  history LeaveAllocationHistory[]

  @@unique([userId, year])
  @@index([year])
  @@schema("leave")
}

model LeaveAllocationHistory {
  id           String               @id @default(cuid())
  allocationId String
  allocation   LeaveAllocation      @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  userId       String
  changeType   AllocationChangeType
  changeDays   Decimal              @db.Decimal(6, 2)
  reason       String
  reasonDetail String?
  beforeDays   Decimal              @db.Decimal(6, 2)
  afterDays    Decimal              @db.Decimal(6, 2)
  createdById  String?
  createdAt    DateTime             @default(now())

  @@index([allocationId])
  @@index([userId, createdAt])
  @@schema("leave")
}

model LeaveRequest {
  id                 String             @id @default(cuid())
  userId             String
  leaveType          LeaveType
  leaveSubType       LeaveSubType?
  quarterStartTime   String?
  startDate          DateTime
  endDate            DateTime
  days               Decimal            @db.Decimal(6, 2)
  reason             String?
  status             LeaveRequestStatus @default(PENDING)
  appliedAt          DateTime           @default(now())
  reviewedById       String?
  reviewedAt         DateTime?
  rejectionReason    String?
  cancelledAt        DateTime?
  cancellationReason String?
  isCarriedOver      Boolean            @default(false)
  adminActionNote    String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  @@index([userId, startDate])
  @@index([status])
  @@index([reviewedById])
  @@schema("leave")
}

model CalendarSource {
  id              String             @id @default(cuid())
  key             String             @unique
  kind            CalendarSourceKind
  name            String
  provider        String?
  externalId      String?
  color           String?
  ownerUserId     String?
  visibility      CalendarVisibility @default(TEAM)
  syncStatus      CalendarSyncStatus @default(ACTIVE)
  cacheTtlSeconds Int                @default(900)
  settings        Json?
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  events       CalendarEvent[]
  cacheEntries CalendarCacheEntry[]

  @@index([kind])
  @@index([ownerUserId])
  @@schema("calendar")
}

model CalendarEvent {
  id                 String              @id @default(cuid())
  sourceId           String?
  source             CalendarSource?     @relation(fields: [sourceId], references: [id], onDelete: SetNull)
  kind               CalendarEventKind
  title              String
  redactedTitle      String?
  description        String?
  startsAt           DateTime
  endsAt             DateTime
  allDay             Boolean             @default(true)
  userId             String?
  originModule       String?
  originId           String?
  externalEventId    String?
  visibility         CalendarVisibility  @default(TEAM)
  dedupStatus        CalendarDedupStatus @default(UNIQUE)
  duplicateOfEventId String?
  metadata           Json?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  @@unique([sourceId, externalEventId])
  @@index([startsAt, endsAt])
  @@index([kind, startsAt])
  @@index([userId, startsAt])
  @@index([originModule, originId])
  @@schema("calendar")
}

model CalendarCacheEntry {
  id           String         @id @default(cuid())
  sourceId     String
  source       CalendarSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  rangeStart   DateTime
  rangeEnd     DateTime
  payload      Json
  fetchedAt    DateTime       @default(now())
  expiresAt    DateTime
  errorMessage String?

  @@unique([sourceId, rangeStart, rangeEnd])
  @@index([expiresAt])
  @@schema("calendar")
}
```

### 2. 검증

```bash
npm run prisma:validate
```

기대 출력: `The schema at prisma\schema.prisma is valid 🚀`.

### 3. 커밋

```bash
git add prisma/schema.prisma
git commit -m "Restructure schema: multiSchema, soft-ref CalendarEvent, kernel cleanup, outbox"
```

## Acceptance Criteria

- `npm run prisma:validate` → valid.
- `User`에 모듈 역참조 컬렉션이 없다(grep으로 `workflowTasks`·`leaveRequests`·`calendarEvents`가 `model User {` 블록에 없음).
- `CalendarEvent`에 `workflowTask`/`leaveRequest` relation과 `workflowTaskId`/`leaveRequestId`가 없고 `originModule`/`originId`가 있다.
- 모든 model·enum에 `@@schema(...)`가 있다(누락 시 validate 실패).
- `OutboxEvent`/`OutboxStatus`가 `kernel` 스키마로 존재한다.

## Cautions

- **Don't enum에 `@@schema`를 빼먹지 마라. Reason:** multiSchema에서는 enum도 스키마 배정이 필수다. 빠지면 `prisma validate`가 에러를 낸다.
- **Don't 끊은 관계를 살리겠다고 모듈 모델에 `user User @relation`을 다시 넣지 마라. Reason:** 그러면 Prisma가 `User`에 역참조를 강제해 "커널이 모듈을 아는" 구조로 되돌아간다(이번 결정: plain userId, FK 없음).
- **Don't `sourceId`를 origin 식별자로 재사용하지 마라. Reason:** `sourceId`/`source`는 이미 CalendarSource(feed) FK다. 원본(workflow/leave) 소프트 참조는 `originModule`/`originId`로 분리한다.
