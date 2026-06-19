import { LEAVE_KEYWORDS } from "../constants";
import { rangesOverlap } from "../time";
import type { RawEvent } from "../types";

function hasLeaveKeyword(title: string): boolean {
  return LEAVE_KEYWORDS.some((k) => title.includes(k));
}

export function applyDedup(events: RawEvent[]): RawEvent[] {
  // APPROVED 내부 휴가만 권위 앵커. PENDING(tentative)은 확정 전이라 외부 휴가를 접는 근거가 될 수 없다(Finding 3).
  const internalLeaves = events.filter((e) => e.kind === "INTERNAL_LEAVE" && !e.tentative);
  return events.map((e) => {
    if (e.kind !== "EXTERNAL_EVENT" && e.kind !== "EXTERNAL_VACATION") return e;

    const kind = e.kind === "EXTERNAL_EVENT" && e.allDay && hasLeaveKeyword(e.title) ? "EXTERNAL_VACATION" : e.kind;

    if (kind === "EXTERNAL_VACATION" && e.userId) {
      const dup = internalLeaves.find((i) => i.userId === e.userId && rangesOverlap(e.start, e.end, i.start, i.end));
      if (dup) return { ...e, kind, dedupStatus: "DUPLICATE_OF_INTERNAL", duplicateOfId: dup.id };
    }
    return kind === e.kind ? e : { ...e, kind };
  });
}
