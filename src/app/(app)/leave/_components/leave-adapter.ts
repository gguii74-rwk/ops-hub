import { allDayHalfOpen } from "@/modules/calendar/time";
import { getFullLeaveText } from "@/modules/leave/labels";
import type { CalendarEventInput, EventStatus } from "@/modules/calendar/ui/event-input";

// 연차 캘린더 API(/api/leave/calendar) 응답 1건. (기존 leave-calendar.tsx의 Ev에서 이동)
export interface Ev {
  id: string;
  userId: string;
  name: string;
  leaveType: string;
  leaveSubType: string | null;
  quarterStartTime: string | null;
  startDate: string;
  endDate: string;
  status: string;
  isSelf: boolean;
}

// 연차 Ev → 공통 모델. endDate가 inclusive 종료일이라 allDayHalfOpen으로 half-open 변환(D14②).
// kind = leaveType(종류색, soft), status = 그대로(오버레이), title = 이름 + 전체 휴가 텍스트.
export function leaveToEvents(evs: Ev[]): CalendarEventInput[] {
  return evs.map((e) => {
    const { start, end } = allDayHalfOpen(new Date(e.startDate), new Date(e.endDate));
    return {
      id: e.id,
      title: `${e.name} ${getFullLeaveText(e.leaveType, e.leaveSubType, e.quarterStartTime)}`,
      kind: e.leaveType,
      start: start.toISOString(),
      end: end.toISOString(),
      status: e.status as EventStatus,
    };
  });
}
