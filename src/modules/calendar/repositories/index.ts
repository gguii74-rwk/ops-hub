import { Prisma } from "@prisma/client";
import type { LeaveRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { NormalizedRange } from "../types";

export interface LeaveRow {
  id: string;
  userId: string;
  leaveType: string;
  reason: string | null;
  startDate: Date;
  endDate: Date;
  status: LeaveRequestStatus;
}
export interface WorkflowRow {
  id: string;
  title: string;
  scheduledAt: Date;
  status: string;
}
export interface ManualRow {
  id: string;
  kind: "PERSONAL_EVENT" | "TEAM_EVENT";
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
}
export interface SourceRow {
  id: string;
  key: string;
  externalId: string | null;
  name: string;
  cacheTtlSeconds: number;
  ownerUserId: string | null; // dedup용 사용자 attribution(§10). 공유 캘린더면 null.
}
export interface CacheRow {
  payload: unknown;
  fetchedAt: Date;
  expiresAt: Date;
  errorMessage: string | null;
}

export async function findLeaveInRange(range: NormalizedRange, statuses: LeaveRequestStatus[]): Promise<LeaveRow[]> {
  const rows = await prisma.leaveRequest.findMany({
    where: { status: { in: statuses }, startDate: { lt: range.end }, endDate: { gte: range.start } },
    select: { id: true, userId: true, leaveType: true, reason: true, startDate: true, endDate: true, status: true },
    orderBy: { startDate: "asc" },
  });
  return rows.map((r) => ({ ...r, leaveType: String(r.leaveType) }));
}

export async function findWorkflowTasksInRange(range: NormalizedRange): Promise<WorkflowRow[]> {
  const rows = await prisma.workflowTask.findMany({
    where: { scheduledAt: { gte: range.start, lt: range.end } },
    select: { id: true, scheduledAt: true, status: true, type: { select: { name: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, title: r.type.name, scheduledAt: r.scheduledAt, status: String(r.status) }));
}

export async function findManualEventsInRange(
  range: NormalizedRange,
  viewer: { userId: string; includeAllPersonal: boolean },
): Promise<ManualRow[]> {
  const rows = await prisma.calendarEvent.findMany({
    where: {
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
      // TEAM_EVENT은 전원 공개. PERSONAL_EVENT은 본인만(admin이면 전체) — 마스킹 이전 단계에서 차단(타인 일정 시각·신원 유출 방지).
      OR: [
        { kind: "TEAM_EVENT" },
        viewer.includeAllPersonal ? { kind: "PERSONAL_EVENT" } : { kind: "PERSONAL_EVENT", userId: viewer.userId },
      ],
    },
    select: { id: true, kind: true, title: true, description: true, startsAt: true, endsAt: true, allDay: true, userId: true, source: { select: { key: true } } },
    orderBy: { startsAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "PERSONAL_EVENT" | "TEAM_EVENT",
    title: r.title,
    description: r.description,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    allDay: r.allDay,
    userId: r.userId,
    sourceKey: r.source?.key ?? "manual",
  }));
}

export async function findSourcesByKind(kinds: Array<"GOOGLE_CALENDAR" | "HOLIDAY">): Promise<SourceRow[]> {
  return prisma.calendarSource.findMany({
    where: { kind: { in: kinds }, syncStatus: "ACTIVE" },
    select: { id: true, key: true, externalId: true, name: true, cacheTtlSeconds: true, ownerUserId: true },
  });
}

export async function readCacheEntry(sourceId: string, range: NormalizedRange): Promise<CacheRow | null> {
  return prisma.calendarCacheEntry.findUnique({
    where: { sourceId_rangeStart_rangeEnd: { sourceId, rangeStart: range.start, rangeEnd: range.end } },
    select: { payload: true, fetchedAt: true, expiresAt: true, errorMessage: true },
  });
}

export async function writeCacheEntry(
  sourceId: string,
  range: NormalizedRange,
  payload: unknown,
  expiresAt: Date,
  errorMessage: string | null,
): Promise<void> {
  // cold 실패 마커는 payload=null(JSON null)로 기록 → 읽기 시 warm(last-good 보존, stale) vs cold(failed) 구분(§Task 03).
  const json = payload === null ? Prisma.JsonNull : (payload as Prisma.InputJsonValue);
  await prisma.calendarCacheEntry.upsert({
    where: { sourceId_rangeStart_rangeEnd: { sourceId, rangeStart: range.start, rangeEnd: range.end } },
    create: { sourceId, rangeStart: range.start, rangeEnd: range.end, payload: json, expiresAt, errorMessage },
    update: { payload: json, expiresAt, errorMessage, fetchedAt: new Date() },
  });
}
