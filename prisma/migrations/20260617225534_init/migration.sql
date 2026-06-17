-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "calendar";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "kernel";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "leave";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "workflows";

-- CreateEnum
CREATE TYPE "kernel"."SystemRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "kernel"."UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "kernel"."EmploymentType" AS ENUM ('REGULAR', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "kernel"."JobFunction" AS ENUM ('PM', 'DEVELOPER', 'CONTENT_MANAGER', 'CIVIL_RESPONSE');

-- CreateEnum
CREATE TYPE "kernel"."PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "kernel"."OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "workflows"."WorkflowKind" AS ENUM ('WEEKLY_REPORT', 'BILLING', 'NOTIFICATION_BILLING');

-- CreateEnum
CREATE TYPE "workflows"."WorkflowStatus" AS ENUM ('PENDING', 'GENERATED', 'REVIEWED', 'SENT', 'HQ_REQUESTED', 'FINAL_SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "leave"."LeaveType" AS ENUM ('ANNUAL', 'HALF', 'QUARTER');

-- CreateEnum
CREATE TYPE "leave"."LeaveSubType" AS ENUM ('MORNING', 'AFTERNOON');

-- CreateEnum
CREATE TYPE "leave"."LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "leave"."AllocationChangeType" AS ENUM ('INITIAL', 'ADD', 'DEDUCT', 'CARRYOVER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "calendar"."CalendarSourceKind" AS ENUM ('INTERNAL_LEAVE', 'WORKFLOW', 'GOOGLE_CALENDAR', 'HOLIDAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "calendar"."CalendarEventKind" AS ENUM ('WORKFLOW_TASK', 'INTERNAL_LEAVE', 'EXTERNAL_VACATION', 'EXTERNAL_EVENT', 'HOLIDAY', 'PERSONAL_EVENT', 'TEAM_EVENT');

-- CreateEnum
CREATE TYPE "calendar"."CalendarVisibility" AS ENUM ('PRIVATE', 'TEAM', 'INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "calendar"."CalendarSyncStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "calendar"."CalendarDedupStatus" AS ENUM ('UNIQUE', 'DUPLICATE_OF_INTERNAL', 'DUPLICATE_OF_EXTERNAL', 'IGNORED');

-- CreateTable
CREATE TABLE "kernel"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "joinDate" TIMESTAMP(3),
    "employmentType" "kernel"."EmploymentType" NOT NULL,
    "jobFunction" "kernel"."JobFunction" NOT NULL,
    "systemRole" "kernel"."SystemRole" NOT NULL DEFAULT 'MEMBER',
    "status" "kernel"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."AccessRole" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."Permission" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "kernel"."PermissionEffect" NOT NULL DEFAULT 'ALLOW',
    "scope" TEXT NOT NULL DEFAULT 'all',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."UserAccessRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "kernel"."PermissionEffect" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "reason" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."NavigationItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiredPermissionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavigationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "kernel"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kernel"."SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "kernel"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."WorkflowType" (
    "id" TEXT NOT NULL,
    "kind" "workflows"."WorkflowKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templatePath" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL,
    "defaultRecipients" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."WorkflowTask" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "workflows"."WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "outputPath" TEXT,
    "recipients" JSONB,
    "createdById" TEXT,
    "generatedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."GeneratedFile" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."MailDelivery" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "step" TEXT,
    "recipients" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "attachmentPaths" JSONB,
    "providerMessageId" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."BillingConfig" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "projectName" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "contractAmount" BIGINT NOT NULL,
    "monthlyAmount" BIGINT NOT NULL,
    "contractAmountKor" TEXT NOT NULL DEFAULT '',
    "monthlyAmountKor" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."BillingRoundDate" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "submitDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRoundDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows"."Deliverable" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "completionDate" TEXT,
    "progress" TEXT,
    "delayReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave"."LeaveAllocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allocatedDays" DECIMAL(6,2) NOT NULL,
    "carriedOverDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "carriedOverExpiryDate" TIMESTAMP(3),
    "usedDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave"."LeaveAllocationHistory" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changeType" "leave"."AllocationChangeType" NOT NULL,
    "changeDays" DECIMAL(6,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonDetail" TEXT,
    "beforeDays" DECIMAL(6,2) NOT NULL,
    "afterDays" DECIMAL(6,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAllocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave"."LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveType" "leave"."LeaveType" NOT NULL,
    "leaveSubType" "leave"."LeaveSubType",
    "quarterStartTime" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "status" "leave"."LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "isCarriedOver" BOOLEAN NOT NULL DEFAULT false,
    "adminActionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar"."CalendarSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "calendar"."CalendarSourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "externalId" TEXT,
    "color" TEXT,
    "ownerUserId" TEXT,
    "visibility" "calendar"."CalendarVisibility" NOT NULL DEFAULT 'TEAM',
    "syncStatus" "calendar"."CalendarSyncStatus" NOT NULL DEFAULT 'ACTIVE',
    "cacheTtlSeconds" INTEGER NOT NULL DEFAULT 900,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar"."CalendarEvent" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "kind" "calendar"."CalendarEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "redactedTitle" TEXT,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "originModule" TEXT,
    "originId" TEXT,
    "externalEventId" TEXT,
    "visibility" "calendar"."CalendarVisibility" NOT NULL DEFAULT 'TEAM',
    "dedupStatus" "calendar"."CalendarDedupStatus" NOT NULL DEFAULT 'UNIQUE',
    "duplicateOfEventId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar"."CalendarCacheEntry" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "CalendarCacheEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "kernel"."User"("email");

-- CreateIndex
CREATE INDEX "User_employmentType_jobFunction_idx" ON "kernel"."User"("employmentType", "jobFunction");

-- CreateIndex
CREATE INDEX "User_systemRole_idx" ON "kernel"."User"("systemRole");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_key_key" ON "kernel"."AccessRole"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "kernel"."Permission"("resource", "action");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "kernel"."RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_scope_key" ON "kernel"."RolePermission"("roleId", "permissionId", "scope");

-- CreateIndex
CREATE INDEX "UserAccessRole_roleId_idx" ON "kernel"."UserAccessRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccessRole_userId_roleId_key" ON "kernel"."UserAccessRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_permissionId_idx" ON "kernel"."UserPermissionOverride"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_permissionId_scope_key" ON "kernel"."UserPermissionOverride"("userId", "permissionId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "NavigationItem_key_key" ON "kernel"."NavigationItem"("key");

-- CreateIndex
CREATE INDEX "NavigationItem_parentId_sortOrder_idx" ON "kernel"."NavigationItem"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "NavigationItem_requiredPermissionId_idx" ON "kernel"."NavigationItem"("requiredPermissionId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "kernel"."OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "kernel"."AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "kernel"."AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowType_kind_key" ON "workflows"."WorkflowType"("kind");

-- CreateIndex
CREATE INDEX "WorkflowTask_typeId_scheduledAt_idx" ON "workflows"."WorkflowTask"("typeId", "scheduledAt");

-- CreateIndex
CREATE INDEX "WorkflowTask_status_idx" ON "workflows"."WorkflowTask"("status");

-- CreateIndex
CREATE INDEX "GeneratedFile_taskId_idx" ON "workflows"."GeneratedFile"("taskId");

-- CreateIndex
CREATE INDEX "MailDelivery_taskId_idx" ON "workflows"."MailDelivery"("taskId");

-- CreateIndex
CREATE INDEX "MailDelivery_sentAt_idx" ON "workflows"."MailDelivery"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingConfig_year_key" ON "workflows"."BillingConfig"("year");

-- CreateIndex
CREATE INDEX "BillingRoundDate_year_idx" ON "workflows"."BillingRoundDate"("year");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRoundDate_year_round_key" ON "workflows"."BillingRoundDate"("year", "round");

-- CreateIndex
CREATE INDEX "Deliverable_year_idx" ON "workflows"."Deliverable"("year");

-- CreateIndex
CREATE UNIQUE INDEX "Deliverable_year_label_key" ON "workflows"."Deliverable"("year", "label");

-- CreateIndex
CREATE INDEX "LeaveAllocation_year_idx" ON "leave"."LeaveAllocation"("year");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAllocation_userId_year_key" ON "leave"."LeaveAllocation"("userId", "year");

-- CreateIndex
CREATE INDEX "LeaveAllocationHistory_allocationId_idx" ON "leave"."LeaveAllocationHistory"("allocationId");

-- CreateIndex
CREATE INDEX "LeaveAllocationHistory_userId_createdAt_idx" ON "leave"."LeaveAllocationHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_startDate_idx" ON "leave"."LeaveRequest"("userId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "leave"."LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "LeaveRequest_reviewedById_idx" ON "leave"."LeaveRequest"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSource_key_key" ON "calendar"."CalendarSource"("key");

-- CreateIndex
CREATE INDEX "CalendarSource_kind_idx" ON "calendar"."CalendarSource"("kind");

-- CreateIndex
CREATE INDEX "CalendarSource_ownerUserId_idx" ON "calendar"."CalendarSource"("ownerUserId");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_endsAt_idx" ON "calendar"."CalendarEvent"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_kind_startsAt_idx" ON "calendar"."CalendarEvent"("kind", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_startsAt_idx" ON "calendar"."CalendarEvent"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_originModule_originId_idx" ON "calendar"."CalendarEvent"("originModule", "originId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_sourceId_externalEventId_key" ON "calendar"."CalendarEvent"("sourceId", "externalEventId");

-- CreateIndex
CREATE INDEX "CalendarCacheEntry_expiresAt_idx" ON "calendar"."CalendarCacheEntry"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarCacheEntry_sourceId_rangeStart_rangeEnd_key" ON "calendar"."CalendarCacheEntry"("sourceId", "rangeStart", "rangeEnd");

-- AddForeignKey
ALTER TABLE "kernel"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "kernel"."AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "kernel"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "kernel"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "kernel"."AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "kernel"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "kernel"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."NavigationItem" ADD CONSTRAINT "NavigationItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "kernel"."NavigationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."NavigationItem" ADD CONSTRAINT "NavigationItem_requiredPermissionId_fkey" FOREIGN KEY ("requiredPermissionId") REFERENCES "kernel"."Permission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kernel"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "kernel"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows"."WorkflowTask" ADD CONSTRAINT "WorkflowTask_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "workflows"."WorkflowType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows"."GeneratedFile" ADD CONSTRAINT "GeneratedFile_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflows"."WorkflowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows"."MailDelivery" ADD CONSTRAINT "MailDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workflows"."WorkflowTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave"."LeaveAllocationHistory" ADD CONSTRAINT "LeaveAllocationHistory_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "leave"."LeaveAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar"."CalendarEvent" ADD CONSTRAINT "CalendarEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "calendar"."CalendarSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar"."CalendarCacheEntry" ADD CONSTRAINT "CalendarCacheEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "calendar"."CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
