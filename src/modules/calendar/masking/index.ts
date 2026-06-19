import type { CalendarEventKind } from "@prisma/client";
import type { CalEvent, FeedContext, RawEvent } from "../types";

const GENERIC_TITLE: Partial<Record<CalendarEventKind, string>> = {
  INTERNAL_LEAVE: "휴가",
  EXTERNAL_VACATION: "휴가",
  PERSONAL_EVENT: "개인 일정",
  EXTERNAL_EVENT: "외부 일정",
};

function isSensitiveKind(kind: CalendarEventKind): boolean {
  return (
    kind === "INTERNAL_LEAVE" ||
    kind === "EXTERNAL_VACATION" ||
    kind === "PERSONAL_EVENT" ||
    kind === "EXTERNAL_EVENT"
  );
}

function canSeeDetail(raw: RawEvent, ctx: FeedContext): boolean {
  if (ctx.isOwner) return true;
  if (raw.userId && raw.userId === ctx.userId) return true;
  if (ctx.permissionKeys.has("calendar.admin:view")) return true;
  return false;
}

export function maskEvent(raw: RawEvent, ctx: FeedContext): CalEvent {
  const masked = isSensitiveKind(raw.kind) && !canSeeDetail(raw, ctx);
  return {
    id: raw.id,
    kind: raw.kind,
    title: masked ? GENERIC_TITLE[raw.kind] ?? "비공개" : raw.title,
    description: masked ? null : raw.description,
    start: raw.start.toISOString(),
    end: raw.end.toISOString(),
    allDay: raw.allDay,
    userId: raw.userId,
    sourceKey: raw.sourceKey,
    dedupStatus: raw.dedupStatus,
    masked,
    tentative: raw.tentative, // 가시성/접기 판단은 feed가 함 — 마스킹은 플래그만 통과
  };
}
