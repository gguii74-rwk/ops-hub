import type { CalendarEventKind, CalendarDedupStatus } from "@prisma/client";

export type ViewKey = "work" | "leave" | "personal" | "team" | "admin";

export interface NormalizedRange {
  start: Date;
  end: Date;
}

export interface RawEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
  externalId: string | null;
  dedupStatus: CalendarDedupStatus;
  duplicateOfId: string | null;
  tentative: boolean; // 미승인(PENDING) 휴가 등 잠정 일정. 본인·admin만 노출, dedup 앵커 제외(§10)
}

export interface CalEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  userId: string | null;
  sourceKey: string;
  dedupStatus: CalendarDedupStatus;
  masked: boolean;
  tentative: boolean; // 잠정(미승인) 일정 — UI가 별도 스타일로 표시
}

export interface SourceStatus {
  key: string;
  state: "ok" | "stale" | "failed";
  lastFetchedAt: string | null;
  error: string | null;
}

export interface FeedResponse {
  events: CalEvent[];
  sources: SourceStatus[];
  staleSources: string[];
  failedSources: string[];
}

export interface FeedContext {
  userId: string;
  isOwner: boolean;
  permissionKeys: Set<string>;
}

export interface SourceResult {
  events: RawEvent[];
  statuses: SourceStatus[];
}

export interface CalendarSourceProvider {
  key: string;
  fetchEvents(range: NormalizedRange, ctx: FeedContext): Promise<SourceResult>;
}
