import type { WorkflowKind, WorkflowStatus } from "@prisma/client";
import { allDayHalfOpen } from "@/modules/calendar/time";
import type { CalendarEventInput } from "@/modules/calendar/ui/event-input";
import { KIND_LABEL } from "./labels";

// 캘린더 조회 응답(GET /api/workflows/calendar) 1건. (services TaskListItem과 동형)
export interface WorkflowCalendarItem {
  id: string;
  kind: WorkflowKind;
  typeName: string;
  scheduledAt: string;
  status: WorkflowStatus;
}

// WorkflowTask → 공통 캘린더 이벤트(순수함수). 예정일 단일일 이벤트:
// kind=WorkflowKind(색 키, SC-6), title=KIND_LABEL(폴백 typeName), start/end=KST 단일일 half-open(D14).
// status 오버레이(D8): CANCELLED만 취소선, PENDING 등 정상 상태는 null(kind색 유지 — PENDING을 넘기면 amber가 색을 덮음).
export function toCalendarEvent(item: WorkflowCalendarItem): CalendarEventInput {
  const d = new Date(item.scheduledAt);
  const { start, end } = allDayHalfOpen(d, d);
  return {
    id: item.id,
    title: KIND_LABEL[item.kind] ?? item.typeName,
    kind: item.kind,
    start: start.toISOString(),
    end: end.toISOString(),
    status: item.status === "CANCELLED" ? "CANCELLED" : null,
  };
}
