import type { CalEvent } from "@/modules/calendar/types";
import type { CalendarEventInput, EventStatus } from "@/modules/calendar/ui/event-input";

// 통합 feed의 CalEvent → 공통 모델. feed가 이미 half-open이라 start/end passthrough(D14①).
// tentative(미승인 잠정) → status PENDING(점선 오버레이). 그 외엔 status 없음(feed가 승인분만 합성).
export function feedToEvents(events: CalEvent[]): CalendarEventInput[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    start: e.start,
    end: e.end,
    status: e.tentative ? ("PENDING" as EventStatus) : null,
  }));
}
